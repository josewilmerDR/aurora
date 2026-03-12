import { useState, useEffect } from 'react';
import './HR.css';
import { FiPlus, FiTrash2, FiSave, FiRefreshCw } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';

const FRECUENCIAS = [
  { value: 'semanal',    label: 'Semanal',                    dias: 7  },
  { value: 'bisemanal',  label: 'Bisemanal (cada 2 semanas)', dias: 14 },
  { value: 'quincenal',  label: 'Quincenal (15 y 30)',        dias: 15 },
  { value: 'mensual',    label: 'Mensual',                    dias: 30 },
];

// Factor multiplicador sobre salario mensual (base = 30 días)
const FACTOR = { semanal: 7/30, bisemanal: 14/30, quincenal: 15/30, mensual: 1 };

// Calcula el período (inicio, fin, etiqueta) según frecuencia y fecha de corte
function getPeriodo(frecuencia, fechaCorte) {
  const corte = new Date(fechaCorte + 'T12:00:00'); // evitar ajuste de zona horaria
  let inicio, fin;

  if (frecuencia === 'mensual') {
    inicio = new Date(corte.getFullYear(), corte.getMonth(), 1);
    fin    = new Date(corte.getFullYear(), corte.getMonth() + 1, 0);
  } else if (frecuencia === 'quincenal') {
    if (corte.getDate() <= 15) {
      inicio = new Date(corte.getFullYear(), corte.getMonth(), 1);
      fin    = new Date(corte.getFullYear(), corte.getMonth(), 15);
    } else {
      inicio = new Date(corte.getFullYear(), corte.getMonth(), 16);
      fin    = new Date(corte.getFullYear(), corte.getMonth() + 1, 0);
    }
  } else if (frecuencia === 'bisemanal') {
    fin    = new Date(corte);
    inicio = new Date(corte);
    inicio.setDate(corte.getDate() - 13); // 14 días inclusive
  } else { // semanal
    fin    = new Date(corte);
    inicio = new Date(corte);
    inicio.setDate(corte.getDate() - 6); // 7 días inclusive
  }

  const fmt = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  return { inicio, fin, label: `${fmt(inicio)} – ${fmt(fin)}` };
}

// Calcula deducción por permisos sin goce aprobados en el período
function calcDeduccionAusencias(permisos, trabajadorId, periodoInicio, periodoFin, salarioMensual) {
  const tasaDiaria = salarioMensual / 30;
  let diasDeducir = 0;

  permisos.forEach(p => {
    if (p.trabajadorId !== trabajadorId) return;
    if (p.estado !== 'aprobado') return;
    const conGoce = p.conGoce !== false; // undefined o true → con goce
    if (conGoce) return;

    const pInicio = new Date(p.fechaInicio);
    const pFin    = new Date(p.fechaFin);
    const overlapStart = new Date(Math.max(pInicio, periodoInicio));
    const overlapEnd   = new Date(Math.min(pFin, periodoFin));

    if (overlapEnd >= overlapStart) {
      const d = Math.round((overlapEnd - overlapStart) / 86400000) + 1;
      diasDeducir += d;
    }
  });

  return Math.round(diasDeducir * tasaDiaria);
}

const fmt = (n) => `₡${Math.max(0, Math.round(Number(n))).toLocaleString('es-CR')}`;

function HrPlanillaSalarioFijo() {
  const apiFetch = useApiFetch();
  const [users, setUsers] = useState([]);
  const [allPermisos, setAllPermisos] = useState([]);
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // Config del período
  const [frecuencia, setFrecuencia]   = useState('quincenal');
  const [fechaCorte, setFechaCorte]   = useState(new Date().toISOString().split('T')[0]);
  const [loaded, setLoaded]           = useState(false);
  const [loading, setLoading]         = useState(false);
  const [saving, setSaving]           = useState(false);

  // Filas de planilla
  const [filas, setFilas] = useState([]);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/hr/permisos').then(r => r.json()),
    ]).then(([u, p]) => {
      setUsers(u);
      setAllPermisos(p);
    }).catch(console.error);
  }, []);

  const handleCargar = async () => {
    setLoading(true);
    try {
      // Fetch all fichas in parallel
      const fichasArr = await Promise.all(
        users.map(u =>
          apiFetch(`/api/hr/fichas/${u.id}`)
            .then(r => r.json())
            .then(d => ({ userId: u.id, ...d }))
            .catch(() => ({ userId: u.id }))
        )
      );
      const fichasMap = {};
      fichasArr.forEach(f => { fichasMap[f.userId] = f; });

      const { inicio, fin } = getPeriodo(frecuencia, fechaCorte);
      const factor = FACTOR[frecuencia];

      const nuevasFilas = users
        .filter(u => {
          const sal = Number(fichasMap[u.id]?.salarioBase);
          return sal > 0;
        })
        .map(u => {
          const salarioMensual  = Number(fichasMap[u.id]?.salarioBase) || 0;
          const salarioPeriodo  = Math.round(salarioMensual * factor);
          const deduccionAusencias = calcDeduccionAusencias(
            allPermisos, u.id, inicio, fin, salarioMensual
          );
          return {
            trabajadorId:       u.id,
            trabajadorNombre:   u.nombre,
            salarioMensual,
            factorDias:         FRECUENCIAS.find(f => f.value === frecuencia)?.dias || 30,
            salarioPeriodo,
            deduccionAusencias,
            deduccionesExtra:   [],
            total:              salarioPeriodo - deduccionAusencias,
            incluir:            true,
          };
        });

      setFilas(nuevasFilas);
      setLoaded(true);
    } catch {
      showToast('Error al cargar datos de empleados.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Recalcular total de una fila
  const recalc = (fila) => {
    const totalExtra = fila.deduccionesExtra.reduce((s, d) => s + (Number(d.monto) || 0), 0);
    return { ...fila, total: fila.salarioPeriodo - fila.deduccionAusencias - totalExtra };
  };

  const toggleIncluir = (id) =>
    setFilas(prev => prev.map(f => f.trabajadorId === id ? { ...f, incluir: !f.incluir } : f));

  const addDeduccion = (id) =>
    setFilas(prev => prev.map(f => {
      if (f.trabajadorId !== id) return f;
      return recalc({ ...f, deduccionesExtra: [...f.deduccionesExtra, { concepto: '', monto: 0 }] });
    }));

  const updateDeduccion = (id, idx, field, value) =>
    setFilas(prev => prev.map(f => {
      if (f.trabajadorId !== id) return f;
      const nuevas = f.deduccionesExtra.map((d, i) =>
        i === idx ? { ...d, [field]: field === 'monto' ? Number(value) || 0 : value } : d
      );
      return recalc({ ...f, deduccionesExtra: nuevas });
    }));

  const removeDeduccion = (id, idx) =>
    setFilas(prev => prev.map(f => {
      if (f.trabajadorId !== id) return f;
      return recalc({ ...f, deduccionesExtra: f.deduccionesExtra.filter((_, i) => i !== idx) });
    }));

  const { label: periodoLabel, inicio: periodoInicio, fin: periodoFin } = getPeriodo(frecuencia, fechaCorte);
  const filasIncluidas = filas.filter(f => f.incluir);
  const totalGeneral   = filasIncluidas.reduce((s, f) => s + Math.max(0, f.total), 0);

  const handleGuardar = async () => {
    if (!filasIncluidas.length) { showToast('No hay empleados en la planilla.', 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        frecuencia,
        periodoInicio: periodoInicio.toISOString(),
        periodoFin:    periodoFin.toISOString(),
        periodoLabel,
        filas: filasIncluidas.map(({ incluir, ...rest }) => rest),
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

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Configuración del período ── */}
      <div className="form-card">
        <h2>Configurar Período</h2>
        <div className="form-grid">
          <div className="form-control">
            <label>Frecuencia de pago</label>
            <select
              value={frecuencia}
              onChange={e => { setFrecuencia(e.target.value); setLoaded(false); }}
            >
              {FRECUENCIAS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label>Fecha de corte / pago</label>
            <input
              type="date"
              value={fechaCorte}
              onChange={e => { setFechaCorte(e.target.value); setLoaded(false); }}
            />
          </div>
        </div>

        <div className="hr-periodo-preview">
          Período: <strong>{periodoLabel}</strong>
          {' · '}Factor: <strong>
            {frecuencia === 'mensual' ? '30/30' : `${FRECUENCIAS.find(f => f.value === frecuencia)?.dias}/30`}
          </strong>
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleCargar} disabled={loading || !users.length}>
            <FiRefreshCw /> {loading ? 'Cargando...' : 'Cargar empleados'}
          </button>
        </div>
      </div>

      {/* ── Tabla de planilla ── */}
      {loaded && (
        <div className="list-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <h2 style={{ margin: 0 }}>Planilla — {periodoLabel}</h2>
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
              <div className="planilla-tabla">
                {filas.map(f => (
                  <div
                    key={f.trabajadorId}
                    className={`planilla-row${!f.incluir ? ' planilla-row--excluido' : ''}`}
                  >
                    {/* Encabezado de la fila */}
                    <div className="planilla-row-header">
                      <label className="planilla-check">
                        <input
                          type="checkbox"
                          checked={f.incluir}
                          onChange={() => toggleIncluir(f.trabajadorId)}
                        />
                        <span className="planilla-nombre">{f.trabajadorNombre}</span>
                      </label>
                      <div className="planilla-montos">
                        <span className="planilla-concepto-tag">
                          ₡{f.salarioMensual.toLocaleString('es-CR')}/mes · {f.factorDias}/30 días
                        </span>
                        <span className="planilla-monto">{fmt(f.salarioPeriodo)}</span>
                      </div>
                    </div>

                    {/* Deducciones y total (solo si incluido) */}
                    {f.incluir && (
                      <>
                        <div className="planilla-deductions">
                          {/* Deducción automática por ausencias */}
                          {f.deduccionAusencias > 0 && (
                            <div className="planilla-ded-row planilla-ded-auto">
                              <span>Ausencias sin goce (automático)</span>
                              <span className="planilla-monto-neg">− {fmt(f.deduccionAusencias)}</span>
                            </div>
                          )}

                          {/* Deducciones manuales */}
                          {f.deduccionesExtra.map((d, idx) => (
                            <div key={idx} className="planilla-ded-row">
                              <input
                                type="text"
                                placeholder="Concepto"
                                value={d.concepto}
                                onChange={e => updateDeduccion(f.trabajadorId, idx, 'concepto', e.target.value)}
                                className="planilla-ded-concepto"
                              />
                              <input
                                type="number"
                                placeholder="0"
                                value={d.monto || ''}
                                min="0"
                                onChange={e => updateDeduccion(f.trabajadorId, idx, 'monto', e.target.value)}
                                className="planilla-ded-monto"
                              />
                              <button
                                onClick={() => removeDeduccion(f.trabajadorId, idx)}
                                className="icon-btn delete"
                                title="Quitar deducción"
                              >
                                <FiTrash2 size={14} />
                              </button>
                            </div>
                          ))}

                          <button
                            className="planilla-add-ded"
                            onClick={() => addDeduccion(f.trabajadorId)}
                          >
                            <FiPlus size={13} /> Agregar deducción
                          </button>
                        </div>

                        <div className="planilla-total-row">
                          <span>Total a pagar</span>
                          <span className={`planilla-total-monto${f.total < 0 ? ' planilla-total--negativo' : ''}`}>
                            {fmt(f.total)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="planilla-grand-total">
                <span>Total general a pagar</span>
                <span>{fmt(totalGeneral)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default HrPlanillaSalarioFijo;
