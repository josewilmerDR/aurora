import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './HR.css';
import { FiPlus, FiTrash2, FiSave, FiRefreshCw, FiEdit2, FiArrowLeft, FiFileText, FiEye, FiCheckCircle, FiXCircle, FiMail, FiThumbsUp } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser } from '../contexts/UserContext';

const CCSS_RATE = 0.1083;
// Horas semanales por defecto si la ficha no tiene horario configurado
const JORNADA_HORAS_DEFAULT = 48;

const DIAS_HORARIO = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
function calcHorasSemanales(horario = {}) {
  return DIAS_HORARIO.reduce((sum, key) => {
    const dia = horario[key];
    if (!dia?.activo || !dia.inicio || !dia.fin) return sum;
    const [h1, m1] = dia.inicio.split(':').map(Number);
    const [h2, m2] = dia.fin.split(':').map(Number);
    return sum + Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
  }, 0);
}

const fmt      = (n) => `₡${Math.max(0, Math.round(Number(n))).toLocaleString('es-CR')}`;
const fmtDate  = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = (d) => d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateStr  = (s) => s.substring(0, 10); // normalize to YYYY-MM-DD

// Build per-day array for the period, marking absent days (approved sin-goce leave).
// Partial permisos (esParcial) accumulate horasParciales per day instead of marking ausente.
// efectivoDesde: the actual first day to include (max of period start and fechaIngreso).
function generarDias(fechaInicio, fechaFin, permisos, trabajadorId, efectivoDesde) {
  const dias  = [];
  const fin   = new Date(fechaFin      + 'T12:00:00');
  const desde = new Date((efectivoDesde || fechaInicio) + 'T12:00:00');
  const cur   = new Date(desde);
  while (cur <= fin) {
    const curStr = cur.toISOString().substring(0, 10);

    // Full-day sin-goce: mark the entire day as ausente
    const ausente = permisos.some(p => {
      if (p.trabajadorId !== trabajadorId) return false;
      if (p.estado !== 'aprobado') return false;
      if (p.conGoce !== false) return false;
      if (p.esParcial) return false;
      const pI = dateStr(p.fechaInicio);
      const pF = dateStr(p.fechaFin);
      return curStr >= pI && curStr <= pF;
    });

    // Partial sin-goce: accumulate hours absent on this specific day
    const horasParciales = ausente ? 0 : permisos.reduce((sum, p) => {
      if (p.trabajadorId !== trabajadorId) return sum;
      if (p.estado !== 'aprobado') return sum;
      if (p.conGoce !== false) return sum;
      if (!p.esParcial) return sum;
      if (dateStr(p.fechaInicio) !== curStr) return sum;
      return sum + (Number(p.horas) || 0);
    }, 0);

    dias.push({ fecha: new Date(cur), ausente, horasParciales, salarioExtra: 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return dias;
}

function recalcFila(fila) {
  const diario = fila.salarioDiario ?? (fila.salarioMensual / 30);
  // Valor-hora = salario mensual × 12 meses / 52 semanas / horas semanales
  const horasSemanales = Number(fila.horasSemanales) || JORNADA_HORAS_DEFAULT;
  const valorHora = (fila.salarioMensual * 12) / 52 / horasSemanales;
  const salarioOrdinario = fila.dias.reduce((s, d) => {
    if (d.ausente) return s;
    const deduccionParcial = (d.horasParciales || 0) * valorHora;
    return s + diario - deduccionParcial;
  }, 0);
  const salarioExtraordinario = fila.dias.reduce((s, d) => s + (Number(d.salarioExtra) || 0), 0);
  const salarioBruto        = salarioOrdinario + salarioExtraordinario;
  const deduccionCCSS       = salarioBruto * CCSS_RATE;
  const otrasDeduccionesTotal = fila.deduccionesExtra.reduce((s, d) => s + (Number(d.monto) || 0), 0);
  const totalDeducciones    = deduccionCCSS + otrasDeduccionesTotal;
  return {
    ...fila,
    salarioOrdinario:       Math.round(salarioOrdinario),
    salarioExtraordinario:  Math.round(salarioExtraordinario),
    salarioBruto:           Math.round(salarioBruto),
    deduccionCCSS:          Math.round(deduccionCCSS),
    otrasDeduccionesTotal:  Math.round(otrasDeduccionesTotal),
    totalDeducciones:       Math.round(totalDeducciones),
    totalNeto:              Math.round(salarioBruto - totalDeducciones),
  };
}

function HrPlanillaSalarioFijo() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const { currentUser } = useUser();
  const [users, setUsers]           = useState([]);
  const [allPermisos, setAllPermisos] = useState([]);
  const [toast, setToast]           = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(currentUser?.rol);
  const canPagar   = ['administrador', 'rrhh'].includes(currentUser?.rol);

  const today = new Date();
  const [fechaInicio, setFechaInicio] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
  );
  const [fechaFin, setFechaFin] = useState(today.toISOString().split('T')[0]);
  const [loaded, setLoaded]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [filas, setFilas]           = useState([]);
  const [detalleId, setDetalleId]   = useState(null);
  const [editingId, setEditingId]   = useState(null); // ID of saved planilla being edited
  const [planillas, setPlanillas]   = useState([]);
  const [confirmModal, setConfirmModal]             = useState(false);
  const [saveConfirmModal, setSaveConfirmModal]     = useState(false);
  const [deleteConfirmId, setDeleteConfirmId]       = useState(null);
  const [aprobarConfirmId, setAprobarConfirmId]     = useState(null);
  const [pagarConfirmId, setPagarConfirmId]         = useState(null);
  const [noEnviarComprobante, setNoEnviarComprobante] = useState(false);

  const fetchPlanillas = () =>
    apiFetch('/api/hr/planilla-fijo').then(r => r.json()).then(setPlanillas).catch(console.error);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/hr/permisos').then(r => r.json()),
    ]).then(([u, p]) => { setUsers(u); setAllPermisos(p); }).catch(console.error);
    fetchPlanillas();
  }, []);

  // Restore state after returning from the report preview
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('aurora_planilla_fijo_state');
      if (!saved) return;
      const { fechaInicio: fi, fechaFin: ff, filas: savedFilas } = JSON.parse(saved);
      const restored = savedFilas.map(f => ({
        ...f,
        dias: (f.dias || []).map(d => ({ ...d, fecha: new Date(d.fecha) })),
      }));
      setFechaInicio(fi);
      setFechaFin(ff);
      setFilas(restored);
      setLoaded(true);
    } catch { /* ignore */ }
  }, []);

  const getPeriodo = () => {
    const inicio = new Date(fechaInicio + 'T12:00:00');
    const fin    = new Date(fechaFin    + 'T12:00:00');
    const dias   = Math.max(1, Math.round((fin - inicio) / 86400000) + 1);
    return { inicio, fin, dias, label: `${fmtDate(inicio)} – ${fmtDate(fin)}` };
  };

  const fechasValidas = fechaInicio && fechaFin && fechaFin >= fechaInicio;

  const handleCargar = async () => {
    if (!fechasValidas) { showToast('La fecha final debe ser igual o posterior a la inicial.', 'error'); return; }
    sessionStorage.removeItem('aurora_planilla_fijo_state');
    setLoading(true);
    try {
      const fichasArr = await Promise.all(
        users.map(u =>
          apiFetch(`/api/hr/fichas/${u.id}`)
            .then(r => r.json()).then(d => ({ userId: u.id, ...d }))
            .catch(() => ({ userId: u.id }))
        )
      );
      const fichasMap = {};
      fichasArr.forEach(f => { fichasMap[f.userId] = f; });

      // Build set of employee IDs already covered by an active planilla
      // that overlaps with the current period (pendiente_pago or pagado).
      // Overlap: existing.inicio <= periodoFin  &&  existing.fin >= periodoInicio
      const ACTIVE = new Set(['pendiente_pago', 'pagado']);
      const bloqueados = new Set();
      planillas.forEach(p => {
        if (!ACTIVE.has(p.estado)) return;
        const pI = p.periodoInicio.substring(0, 10);
        const pF = p.periodoFin.substring(0, 10);
        if (pI <= fechaFin && pF >= fechaInicio) {
          (p.filas || []).forEach(f => bloqueados.add(f.trabajadorId));
        }
      });

      const nuevasFilas = users
        .filter(u => {
          if (!u.empleadoPlanilla || !(Number(fichasMap[u.id]?.salarioBase) > 0)) return false;
          // Exclude employees who haven't started before or on the last day of the period
          const fi = fichasMap[u.id]?.fechaIngreso;
          if (fi && fi > fechaFin) return false;
          // Exclude employees already in an active overlapping planilla
          if (bloqueados.has(u.id)) return false;
          return true;
        })
        .map(u => {
          const ficha          = fichasMap[u.id] || {};
          const fi             = ficha.fechaIngreso || '';
          // If fechaIngreso falls inside the period, only count from that day
          const efectivoDesde  = fi && fi > fechaInicio ? fi : fechaInicio;
          const parcial        = efectivoDesde > fechaInicio;
          const horasSemanales = calcHorasSemanales(ficha.horarioSemanal);
          return recalcFila({
            trabajadorId:      u.id,
            trabajadorNombre:  u.nombre,
            cedula:            ficha.cedula  || '',
            puesto:            ficha.puesto  || '',
            salarioMensual:    Number(ficha.salarioBase) || 0,
            salarioDiario:     Number(ficha.salarioBase) / 30 || 0,
            horasSemanales:    horasSemanales || JORNADA_HORAS_DEFAULT,
            fechaIngreso:      fi,
            periodoParcial:    parcial,
            efectivoDesde:     efectivoDesde,
            dias:              generarDias(fechaInicio, fechaFin, allPermisos, u.id, efectivoDesde),
            deduccionesExtra:  [],
          });
        });

      if (bloqueados.size > 0) {
        const excluidos = bloqueados.size;
        const msg = nuevasFilas.length === 0
          ? `Todos los empleados (${excluidos}) ya tienen planilla activa o pagada para este período.`
          : `${excluidos} empleado(s) excluido(s) por tener planilla activa o pagada en este período.`;
        showToast(msg, nuevasFilas.length === 0 ? 'error' : 'warning');
      }

      setFilas(nuevasFilas);
      setLoaded(true);
      setDetalleId(null);
    } catch {
      showToast('Error al cargar datos de empleados.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Recalculate dias in-place when dates change while editing a saved planilla
  const handleFechaChange = (field, value) => {
    const newInicio = field === 'inicio' ? value : fechaInicio;
    const newFin    = field === 'fin'    ? value : fechaFin;
    if (field === 'inicio') setFechaInicio(value);
    else setFechaFin(value);

    if (!editingId) {
      setLoaded(false);
      setDetalleId(null);
    } else if (newInicio && newFin && newFin >= newInicio) {
      setFilas(prev => prev.map(f => {
        const efectivoDesde = f.fechaIngreso && f.fechaIngreso > newInicio ? f.fechaIngreso : newInicio;
        return recalcFila({ ...f, dias: generarDias(newInicio, newFin, allPermisos, f.trabajadorId, efectivoDesde) });
      }));
      setDetalleId(null);
    }
  };

  const handleSalarioDiarioChange = (id, value) =>
    setFilas(prev => prev.map(f => f.trabajadorId !== id ? f :
      recalcFila({ ...f, salarioDiario: Number(value) || 0 })));

  const handleEliminar = (id) => setFilas(prev => prev.filter(f => f.trabajadorId !== id));

  const handleExtraChange = (id, dayIdx, value) =>
    setFilas(prev => prev.map(f => {
      if (f.trabajadorId !== id) return f;
      const dias = f.dias.map((d, i) => i === dayIdx ? { ...d, salarioExtra: Number(value) || 0 } : d);
      return recalcFila({ ...f, dias });
    }));

  const addDeduccion = (id) =>
    setFilas(prev => prev.map(f => f.trabajadorId !== id ? f :
      recalcFila({ ...f, deduccionesExtra: [...f.deduccionesExtra, { concepto: '', monto: 0 }] })));

  const updateDeduccion = (id, idx, field, value) =>
    setFilas(prev => prev.map(f => {
      if (f.trabajadorId !== id) return f;
      const deduccionesExtra = f.deduccionesExtra.map((d, i) =>
        i === idx ? { ...d, [field]: field === 'monto' ? Number(value) || 0 : value } : d);
      return recalcFila({ ...f, deduccionesExtra });
    }));

  const removeDeduccion = (id, idx) =>
    setFilas(prev => prev.map(f => f.trabajadorId !== id ? f :
      recalcFila({ ...f, deduccionesExtra: f.deduccionesExtra.filter((_, i) => i !== idx) })));

  const { label: periodoLabel, inicio: periodoInicio, fin: periodoFin, dias: periodoDias } = getPeriodo();
  const totalGeneral = filas.reduce((s, f) => s + Math.max(0, f.totalNeto), 0);

  const handleGuardar = async () => {
    if (!filas.length) { showToast('No hay empleados en la planilla.', 'error'); return; }
    setSaving(true);
    try {
      const filasPayload = filas.map(({ dias, ...rest }) => ({
        ...rest,
        dias: (dias || []).map(d => ({ ...d, fecha: d.fecha instanceof Date ? d.fecha.toISOString() : d.fecha })),
      }));
      if (editingId) {
        // Update existing pendiente planilla
        const res = await apiFetch(`/api/hr/planilla-fijo/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            filas: filasPayload,
            totalGeneral,
            periodoInicio: periodoInicio.toISOString(),
            periodoFin:    periodoFin.toISOString(),
            periodoLabel,
          }),
        });
        if (!res.ok) throw new Error();
        setLoaded(false);
        setFilas([]);
        setDetalleId(null);
        showToast('Planilla actualizada correctamente.');
      } else {
        // Create new planilla → pendiente + notify
        const res = await apiFetch('/api/hr/planilla-fijo', {
          method: 'POST',
          body: JSON.stringify({
            periodoInicio: periodoInicio.toISOString(),
            periodoFin:    periodoFin.toISOString(),
            periodoLabel,
            filas: filasPayload,
            totalGeneral,
          }),
        });
        if (!res.ok) throw new Error();
        await res.json(); // consume response (numeroConsecutivo available via fetchPlanillas)
        // Clear the preview area and show success modal
        setLoaded(false);
        setFilas([]);
        setDetalleId(null);
        setConfirmModal(true);
      }
      fetchPlanillas();
      setEditingId(null);
    } catch {
      showToast('Error al guardar la planilla.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEliminarPlanilla = async () => {
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    try {
      const res = await apiFetch(`/api/hr/planilla-fijo/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Planilla eliminada.');
      fetchPlanillas();
    } catch {
      showToast('Error al eliminar la planilla.', 'error');
    }
  };

  const handleAprobarPlanilla = async () => {
    const id = aprobarConfirmId;
    setAprobarConfirmId(null);
    try {
      const res = await apiFetch(`/api/hr/planilla-fijo/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ estado: 'aprobada' }),
      });
      if (!res.ok) throw new Error();
      showToast('Planilla aprobada.');
      fetchPlanillas();
    } catch {
      showToast('Error al aprobar la planilla.', 'error');
    }
  };

  const handleMarcarPagado = async () => {
    const id = pagarConfirmId;
    setPagarConfirmId(null);
    try {
      const res = await apiFetch(`/api/hr/planilla-fijo/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ estado: 'pagada' }),
      });
      if (!res.ok) throw new Error();
      // TODO: if (!noEnviarComprobante) → send payment receipts via email to each employee
      showToast('Planilla marcada como pagada.');
      fetchPlanillas();
    } catch {
      showToast('Error al actualizar el estado.', 'error');
    }
  };

  const handleEditarPlanilla = (p) => {
    const inicio = p.periodoInicio.split('T')[0];
    const fin    = p.periodoFin.split('T')[0];
    // Regenerate dias so recalcFila can recompute correctly on any user change.
    // salarioDiario and deduccionesExtra from the saved planilla are preserved.
    const restoredFilas = p.filas.map(f => {
      const efectivoDesde = f.fechaIngreso && f.fechaIngreso > inicio ? f.fechaIngreso : inicio;
      return recalcFila({
        ...f,
        horasSemanales: f.horasSemanales || JORNADA_HORAS_DEFAULT,
        deduccionesExtra: f.deduccionesExtra || [],
        dias: generarDias(inicio, fin, allPermisos, f.trabajadorId, efectivoDesde),
      });
    });
    setFechaInicio(inicio);
    setFechaFin(fin);
    setFilas(restoredFilas);
    setLoaded(true);
    setDetalleId(null);
    setEditingId(p.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleVerPlanilla = (p) => {
    const data = {
      periodoInicio:     p.periodoInicio,
      periodoFin:        p.periodoFin,
      periodoLabel:      p.periodoLabel,
      totalGeneral:      p.totalGeneral,
      filas:             p.filas,
      numeroConsecutivo: p.numeroConsecutivo || null,
    };
    sessionStorage.setItem('aurora_planilla_reporte', JSON.stringify(data));
    sessionStorage.setItem('aurora_planilla_reporte_origin', '/hr/planilla/fijo');
    sessionStorage.removeItem('aurora_planilla_fijo_state'); // Don't restore draft on return
    navigate('/hr/planilla/fijo/reporte');
  };

  const handleGenerarReporte = () => {
    const data = {
      periodoInicio:     periodoInicio.toISOString(),
      periodoFin:        periodoFin.toISOString(),
      periodoLabel,
      totalGeneral,
      filas:             filas.map(({ dias, ...rest }) => ({
        ...rest,
        dias: (dias || []).map(d => ({ ...d, fecha: d.fecha instanceof Date ? d.fecha.toISOString() : d.fecha })),
      })),
      numeroConsecutivo: null, // Not yet saved — shown as BORRADOR in report
    };
    sessionStorage.setItem('aurora_planilla_reporte', JSON.stringify(data));
    sessionStorage.setItem('aurora_planilla_reporte_origin', '/hr/planilla/fijo');
    sessionStorage.setItem('aurora_planilla_fijo_state', JSON.stringify({ fechaInicio, fechaFin, filas }));
    navigate('/hr/planilla/fijo/reporte');
  };

  const filaDetalle = filas.find(f => f.trabajadorId === detalleId);

  return (
    <div className="planilla-page-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Configurar período + tabla de resultados ── */}
      <div className="form-card">
        <h2>Configurar Período</h2>
        <div className="planilla-config-bar">
          <div className="form-control">
            <label>Fecha inicio</label>
            <input type="date" value={fechaInicio}
              onChange={e => handleFechaChange('inicio', e.target.value)} />
          </div>
          <div className="form-control">
            <label>Fecha fin</label>
            <input type="date" value={fechaFin}
              onChange={e => handleFechaChange('fin', e.target.value)} />
          </div>
          <button className="btn btn-primary planilla-config-btn" onClick={handleCargar}
            disabled={loading || !users.length || !fechasValidas}>
            <FiRefreshCw /> {loading ? 'Cargando...' : 'Previsualizar'}
          </button>
        </div>
        {fechasValidas && (
          <div className="hr-periodo-preview">
            Período: <strong>{periodoLabel}</strong>
            {' · '}Factor: <strong>{periodoDias}/30 días</strong>
          </div>
        )}

        {/* ── Grid de resumen (dentro de la misma card) ── */}
        {loaded && !detalleId && (
          <>
            <div className="planilla-sum-section-divider" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <span className="form-section-title" style={{ margin: 0 }}>Planilla — {periodoLabel}</span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-secondary" title="Descartar y cerrar" onClick={() => {
                  setLoaded(false); setFilas([]); setDetalleId(null); setEditingId(null);
                  sessionStorage.removeItem('aurora_planilla_fijo_state');
                }}>
                  <FiXCircle size={15} /> Cancelar
                </button>
                <button className="btn btn-secondary" onClick={handleGenerarReporte}>
                  <FiFileText /> Previsualizar Planilla
                </button>
                <button className="btn btn-primary" onClick={() => setSaveConfirmModal(true)} disabled={saving}>
                  <FiSave /> {saving ? 'Guardando...' : editingId ? 'Actualizar planilla' : 'Guardar planilla'}
                </button>
              </div>
            </div>

            {filas.length === 0 ? (
              <p className="empty-state">
                No hay empleados con salario base configurado. Completa la Ficha del Trabajador primero.
              </p>
            ) : (
              <>
                <div className="planilla-sum-wrap">
                  <div className="planilla-sum-header">
                    <div>Nombre</div>
                    <div>Ordinario</div>
                    <div>Extraordinario</div>
                    <div>Salario Bruto</div>
                    <div>Deducciones</div>
                    <div>Total Neto</div>
                    <div></div>
                  </div>
                  {filas.map(f => (
                    <div key={f.trabajadorId} className="planilla-sum-row">
                      <div className="planilla-sum-nombre">
                        {f.trabajadorNombre}
                        {f.periodoParcial && (
                          <span className="planilla-parcial-badge"
                            title={`Ingresó el ${fmtShort(new Date(f.fechaIngreso + 'T12:00:00'))} — período parcial`}>
                            ⚠ Ingreso {fmtShort(new Date(f.fechaIngreso + 'T12:00:00'))}
                          </span>
                        )}
                      </div>
                      <div>{fmt(f.salarioOrdinario)}</div>
                      <div>{f.salarioExtraordinario > 0
                        ? fmt(f.salarioExtraordinario)
                        : <span className="planilla-sum-dash">—</span>}
                      </div>
                      <div>{fmt(f.salarioBruto)}</div>
                      <div className="planilla-sum-ded">({fmt(f.totalDeducciones)})</div>
                      <div className="planilla-sum-neto">{fmt(f.totalNeto)}</div>
                      <div className="planilla-sum-actions">
                        <button className="icon-btn" title="Modificar" onClick={() => setDetalleId(f.trabajadorId)}>
                          <FiEdit2 size={16} />
                        </button>
                        <button className="icon-btn delete" title="Eliminar de planilla" onClick={() => handleEliminar(f.trabajadorId)}>
                          <FiTrash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="planilla-grand-total">
                  <span>Total general a pagar</span>
                  <span>{fmt(totalGeneral)}</span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Vista detalle de un empleado ── */}
      {loaded && detalleId && filaDetalle && (
        <div className="form-card">
          <button className="btn btn-secondary planilla-detalle-back" onClick={() => setDetalleId(null)}>
            <FiArrowLeft /> Volver a la planilla
          </button>

          {/* Header del empleado */}
          <div className="planilla-det-emp-header">
            <div className="planilla-det-emp-avatar">
              {filaDetalle.trabajadorNombre.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="planilla-det-emp-name">{filaDetalle.trabajadorNombre}</div>
              <div className="planilla-det-emp-sub">
                {filaDetalle.cedula && <span>{filaDetalle.cedula}</span>}
                {filaDetalle.puesto && <span>{filaDetalle.puesto}</span>}
              </div>
            </div>
          </div>

          {/* Salario diario editable */}
          <div className="planilla-det-diario-row">
            <span className="planilla-det-diario-label">Salario diario</span>
            <input
              type="number" min="0" step="100"
              className="planilla-det-diario-input"
              value={filaDetalle.salarioDiario ?? Math.round(filaDetalle.salarioMensual / 30)}
              onChange={e => handleSalarioDiarioChange(detalleId, e.target.value)}
            />
            <span className="planilla-det-diario-hint">
              Base mensual: {fmt(filaDetalle.salarioMensual)} ÷ 30 = {fmt(filaDetalle.salarioMensual / 30)}
              {filaDetalle.horasSemanales
                ? ` · Valor/hora: ${fmt((filaDetalle.salarioMensual * 12) / 52 / filaDetalle.horasSemanales)} (${filaDetalle.horasSemanales}h/sem)`
                : ` · Valor/hora calculado con ${JORNADA_HORAS_DEFAULT}h/sem (horario no configurado)`}
            </span>
          </div>

          {/* Desglose diario */}
          <div className="planilla-det-table-wrap">
            <table className="planilla-det-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Fecha</th>
                  <th>Salario Ordinario</th>
                  <th>Salario Extraordinario</th>
                </tr>
              </thead>
              <tbody>
                {filaDetalle.dias.map((d, idx) => {
                  const diario = filaDetalle.salarioDiario ?? (filaDetalle.salarioMensual / 30);
                  const horasSemanales = Number(filaDetalle.horasSemanales) || JORNADA_HORAS_DEFAULT;
                  const valorHora = (filaDetalle.salarioMensual * 12) / 52 / horasSemanales;
                  const deduccionParcial = d.horasParciales > 0
                    ? d.horasParciales * valorHora
                    : 0;
                  return (
                    <tr key={idx} className={d.ausente ? 'planilla-det-row--ausente' : d.horasParciales > 0 ? 'planilla-det-row--parcial' : ''}>
                      <td style={{ textAlign: 'left' }}>{fmtShort(d.fecha)}</td>
                      <td>
                        {d.ausente ? (
                          <span className="planilla-det-ausente">Ausente (sin goce)</span>
                        ) : d.horasParciales > 0 ? (
                          <span className="planilla-det-parcial-cell">
                            {fmt(diario - deduccionParcial)}
                            <span className="planilla-det-parcial-tag">
                              −{d.horasParciales}h sin goce ({fmt(deduccionParcial)})
                            </span>
                          </span>
                        ) : (
                          fmt(diario)
                        )}
                      </td>
                      <td>
                        <input
                          type="number" min="0"
                          value={d.salarioExtra || ''}
                          placeholder="—"
                          className="planilla-det-extra-input"
                          onChange={e => handleExtraChange(detalleId, idx, e.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ textAlign: 'left' }}>Total Salario</td>
                  <td>{fmt(filaDetalle.salarioOrdinario)}</td>
                  <td>{filaDetalle.salarioExtraordinario > 0 ? fmt(filaDetalle.salarioExtraordinario) : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Resumen final */}
          <div className="planilla-det-summary">
            <div className="planilla-det-sum-row">
              <span>Total Salario Bruto</span>
              <span>{fmt(filaDetalle.salarioBruto)}</span>
            </div>
            <div className="planilla-det-sum-row planilla-det-sum-row--ded">
              <span>Seguridad Social ({(CCSS_RATE * 100).toFixed(2)}%)</span>
              <span>({fmt(filaDetalle.deduccionCCSS)})</span>
            </div>

            {filaDetalle.deduccionesExtra.map((d, idx) => (
              <div key={idx} className="planilla-det-sum-row planilla-det-sum-row--ded planilla-det-sum-row--editable">
                <input
                  type="text" placeholder="Concepto de deducción"
                  value={d.concepto}
                  onChange={e => updateDeduccion(detalleId, idx, 'concepto', e.target.value)}
                  className="planilla-ded-concepto"
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ opacity: 0.5 }}>(</span>
                  <input
                    type="number" placeholder="0" min="0"
                    value={d.monto || ''}
                    onChange={e => updateDeduccion(detalleId, idx, 'monto', e.target.value)}
                    className="planilla-ded-monto"
                  />
                  <span style={{ opacity: 0.5 }}>)</span>
                  <button onClick={() => removeDeduccion(detalleId, idx)}
                    className="icon-btn delete" title="Quitar">
                    <FiTrash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            <div className="planilla-det-sum-row planilla-det-sum-row--add">
              <button className="planilla-add-ded" onClick={() => addDeduccion(detalleId)}>
                <FiPlus size={13} /> Agregar deducción
              </button>
            </div>

            <div className="planilla-det-sum-row">
              <span>Otras deducciones</span>
              <span>({fmt(filaDetalle.otrasDeduccionesTotal)})</span>
            </div>

            <div className="planilla-det-sum-row planilla-det-sum-row--neto">
              <span>Total Salario Neto</span>
              <span>{fmt(filaDetalle.totalNeto)}</span>
            </div>
          </div>

          <div className="form-actions" style={{ marginTop: 24 }}>
            <button className="btn btn-secondary" onClick={() => setDetalleId(null)}>
              <FiArrowLeft /> Volver
            </button>
          </div>
        </div>
      )}

      {/* ── Aprobar confirmation modal ── */}
      {aprobarConfirmId && (
        <div className="planilla-modal-overlay" onClick={() => setAprobarConfirmId(null)}>
          <div className="planilla-modal" onClick={e => e.stopPropagation()}>
            <div className="planilla-modal-icon" style={{ color: '#5599ff' }}><FiThumbsUp size={36} /></div>
            <h3>Aprobar planilla</h3>
            <p>¿Confirma que desea aprobar esta planilla?</p>
            <p className="planilla-modal-sub">Una vez aprobada, quedará lista para que se procese el pago.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button className="btn btn-secondary" onClick={() => setAprobarConfirmId(null)}>Cancelar</button>
              <button className="btn" style={{ background: 'rgba(51,153,255,0.15)', color: '#5599ff', border: '1px solid rgba(51,153,255,0.4)' }}
                onClick={handleAprobarPlanilla}>
                <FiThumbsUp size={14} /> Aprobar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {deleteConfirmId && (
        <div className="planilla-modal-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="planilla-modal" onClick={e => e.stopPropagation()}>
            <div className="planilla-modal-icon" style={{ color: '#ff8080' }}><FiXCircle size={36} /></div>
            <h3>Eliminar planilla</h3>
            <p>¿Está seguro de que desea eliminar esta planilla?</p>
            <p className="planilla-modal-sub">Esta acción no se puede deshacer.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button className="btn btn-secondary" onClick={() => setDeleteConfirmId(null)}>Cancelar</button>
              <button className="btn" style={{ background: 'rgba(255,128,128,0.15)', color: '#ff8080', border: '1px solid rgba(255,128,128,0.4)' }}
                onClick={handleEliminarPlanilla}>
                <FiTrash2 /> Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pagar confirmation modal ── */}
      {pagarConfirmId && (() => {
        const planilla = planillas.find(p => p.id === pagarConfirmId);
        const numEmpleados = planilla?.filas?.length || 0;
        return (
          <div className="planilla-modal-overlay" onClick={() => setPagarConfirmId(null)}>
            <div className="planilla-modal" onClick={e => e.stopPropagation()}>
              <div className="planilla-modal-icon" style={{ color: 'var(--aurora-green)' }}><FiCheckCircle size={36} /></div>
              <h3>Confirmar pago de planilla</h3>
              <p>
                Al confirmar, esta planilla pasará a estado <strong>Pagada</strong>.
              </p>
              <p style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--aurora-light)', opacity: 0.85 }}>
                <FiMail size={15} />
                Se enviará un comprobante de pago por correo electrónico a los <strong>&nbsp;{numEmpleados} empleado{numEmpleados !== 1 ? 's' : ''}</strong>&nbsp;incluidos en esta planilla.
              </p>
              <label className="planilla-modal-checkbox-row">
                <input
                  type="checkbox"
                  checked={noEnviarComprobante}
                  onChange={e => setNoEnviarComprobante(e.target.checked)}
                />
                No enviar comprobante de pago
              </label>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button className="btn btn-secondary" onClick={() => setPagarConfirmId(null)}>Cancelar</button>
                <button className="btn btn-primary" onClick={handleMarcarPagado}>
                  <FiCheckCircle size={14} /> Confirmar pago
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Save confirmation modal ── */}
      {saveConfirmModal && (
        <div className="planilla-modal-overlay" onClick={() => setSaveConfirmModal(false)}>
          <div className="planilla-modal" onClick={e => e.stopPropagation()}>
            <div className="planilla-modal-icon" style={{ color: '#ffc107' }}><FiSave size={36} /></div>
            <h3>{editingId ? 'Actualizar planilla' : 'Guardar planilla'}</h3>
            <p>
              {editingId
                ? 'Se actualizarán los datos de esta planilla pendiente de pago.'
                : `¿Confirma que desea guardar la planilla del período ${periodoLabel}?`}
            </p>
            <p className="planilla-modal-sub">
              {editingId
                ? 'Esta acción sobrescribirá los montos actuales.'
                : 'La planilla pasará a estado Pendiente y se notificará a los supervisores.'}
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button className="btn btn-secondary" onClick={() => setSaveConfirmModal(false)}>Cancelar</button>
              <button className="btn btn-primary" disabled={saving} onClick={() => { setSaveConfirmModal(false); handleGuardar(); }}>
                <FiSave /> {editingId ? 'Actualizar' : 'Confirmar y guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Success confirmation modal ── */}
      {confirmModal && (
        <div className="planilla-modal-overlay" onClick={() => setConfirmModal(false)}>
          <div className="planilla-modal" onClick={e => e.stopPropagation()}>
            <div className="planilla-modal-icon"><FiCheckCircle size={36} /></div>
            <h3>Planilla guardada</h3>
            <p>La planilla ha quedado en estado <strong>Pendiente</strong>.</p>
            <p className="planilla-modal-sub">Se ha enviado una notificación a los supervisores para su aprobación.</p>
            <button className="btn btn-primary" onClick={() => setConfirmModal(false)}>Entendido</button>
          </div>
        </div>
      )}

      {/* ── Historial de planillas ── */}
      {planillas.length > 0 && (
        <div className="form-card">
          <h2>Historial de Planillas</h2>
          <div className="planilla-hist-list">
            <div className="planilla-hist-header">
              <div>Período</div>
              <div>Empleados</div>
              <div>Total</div>
              <div>Estado</div>
              <div></div>
            </div>
            {planillas.map(p => {
              const isPendiente = p.estado === 'pendiente';
              const isAprobada  = p.estado === 'aprobada';
              const isPagada    = p.estado === 'pagada';
              return (
                <div key={p.id} className="planilla-hist-row">
                  <div className="planilla-hist-periodo">{p.periodoLabel}</div>
                  <div>{p.filas?.length ?? '—'}</div>
                  <div className="planilla-hist-total">{fmt(p.totalGeneral)}</div>
                  <div>
                    {isPendiente && <span className="planilla-badge planilla-badge--pendiente">Pendiente</span>}
                    {isAprobada  && <span className="planilla-badge planilla-badge--aprobada">Aprobada</span>}
                    {isPagada    && <span className="planilla-badge planilla-badge--pagada">Pagada</span>}
                    {!isPendiente && !isAprobada && !isPagada && <span className="planilla-badge planilla-badge--otro">{p.estado}</span>}
                  </div>
                  <div className="planilla-hist-actions">
                    <button className="icon-btn" title="Ver planilla" onClick={() => handleVerPlanilla(p)}>
                      <FiEye size={16} />
                    </button>
                    {isPendiente && (
                      <>
                        <button className="icon-btn" title="Editar planilla" onClick={() => handleEditarPlanilla(p)}>
                          <FiEdit2 size={16} />
                        </button>
                        {canAprobar && (
                          <button className="planilla-hist-pay-btn" title="Aprobar planilla"
                            style={{ background: 'rgba(51,153,255,0.15)', color: '#5599ff', border: '1px solid rgba(51,153,255,0.35)' }}
                            onClick={() => setAprobarConfirmId(p.id)}>
                            <FiThumbsUp size={14} /> Aprobar
                          </button>
                        )}
                        <button className="icon-btn delete" title="Eliminar planilla"
                          onClick={() => setDeleteConfirmId(p.id)}>
                          <FiXCircle size={16} />
                        </button>
                      </>
                    )}
                    {isAprobada && canPagar && (
                      <button className="planilla-hist-pay-btn" title="Pagar planilla"
                        onClick={() => { setNoEnviarComprobante(false); setPagarConfirmId(p.id); }}>
                        <FiCheckCircle size={14} /> Pagar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default HrPlanillaSalarioFijo;
