import { useState, useEffect } from 'react';
import './HR.css';
import { FiPlus, FiTrash2, FiSave, FiRefreshCw, FiEdit2, FiArrowLeft } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';

const CCSS_RATE = 0.1083;

const fmt      = (n) => `₡${Math.max(0, Math.round(Number(n))).toLocaleString('es-CR')}`;
const fmtDate  = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = (d) => d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateStr  = (s) => s.substring(0, 10); // normalize to YYYY-MM-DD

// Build per-day array for the period, marking absent days (approved sin-goce leave)
function generarDias(fechaInicio, fechaFin, permisos, trabajadorId) {
  const dias = [];
  const fin  = new Date(fechaFin   + 'T12:00:00');
  const cur  = new Date(fechaInicio + 'T12:00:00');
  while (cur <= fin) {
    const ausente = permisos.some(p => {
      if (p.trabajadorId !== trabajadorId) return false;
      if (p.estado !== 'aprobado') return false;
      if (p.conGoce !== false) return false;
      const pI = new Date(dateStr(p.fechaInicio) + 'T12:00:00');
      const pF = new Date(dateStr(p.fechaFin)    + 'T12:00:00');
      return cur >= pI && cur <= pF;
    });
    dias.push({ fecha: new Date(cur), ausente, salarioExtra: 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return dias;
}

function recalcFila(fila) {
  const diario              = fila.salarioMensual / 30;
  const salarioOrdinario    = fila.dias.reduce((s, d) => s + (d.ausente ? 0 : diario), 0);
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
  const [users, setUsers]           = useState([]);
  const [allPermisos, setAllPermisos] = useState([]);
  const [toast, setToast]           = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const today = new Date();
  const [fechaInicio, setFechaInicio] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
  );
  const [fechaFin, setFechaFin] = useState(today.toISOString().split('T')[0]);
  const [loaded, setLoaded]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [filas, setFilas]       = useState([]);
  const [detalleId, setDetalleId] = useState(null); // employee being edited in detail view

  useEffect(() => {
    Promise.all([
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/hr/permisos').then(r => r.json()),
    ]).then(([u, p]) => { setUsers(u); setAllPermisos(p); }).catch(console.error);
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

      const nuevasFilas = users
        .filter(u => u.empleadoPlanilla && Number(fichasMap[u.id]?.salarioBase) > 0)
        .map(u => recalcFila({
          trabajadorId:    u.id,
          trabajadorNombre: u.nombre,
          cedula:          fichasMap[u.id]?.cedula  || '',
          puesto:          fichasMap[u.id]?.puesto  || '',
          salarioMensual:  Number(fichasMap[u.id]?.salarioBase) || 0,
          dias:            generarDias(fechaInicio, fechaFin, allPermisos, u.id),
          deduccionesExtra: [],
        }));

      setFilas(nuevasFilas);
      setLoaded(true);
      setDetalleId(null);
    } catch {
      showToast('Error al cargar datos de empleados.', 'error');
    } finally {
      setLoading(false);
    }
  };

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
      const payload = {
        periodoInicio: periodoInicio.toISOString(),
        periodoFin:    periodoFin.toISOString(),
        periodoLabel,
        filas: filas.map(({ dias, ...rest }) => rest),
        totalGeneral,
      };
      const res = await apiFetch('/api/hr/planilla-fijo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      showToast('Planilla guardada correctamente.');
    } catch {
      showToast('Error al guardar la planilla.', 'error');
    } finally {
      setSaving(false);
    }
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
              onChange={e => { setFechaInicio(e.target.value); setLoaded(false); setDetalleId(null); }} />
          </div>
          <div className="form-control">
            <label>Fecha fin</label>
            <input type="date" value={fechaFin}
              onChange={e => { setFechaFin(e.target.value); setLoaded(false); setDetalleId(null); }} />
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
              <button className="btn btn-primary" onClick={handleGuardar} disabled={saving}>
                <FiSave /> {saving ? 'Guardando...' : 'Guardar planilla'}
              </button>
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
                      <div className="planilla-sum-nombre">{f.trabajadorNombre}</div>
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
                {filaDetalle.dias.map((d, idx) => (
                  <tr key={idx} className={d.ausente ? 'planilla-det-row--ausente' : ''}>
                    <td style={{ textAlign: 'left' }}>{fmtShort(d.fecha)}</td>
                    <td>
                      {d.ausente
                        ? <span className="planilla-det-ausente">Ausente con permiso</span>
                        : fmt(filaDetalle.salarioMensual / 30)
                      }
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
                ))}
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
    </div>
  );
}

export default HrPlanillaSalarioFijo;
