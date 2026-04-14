import { useState, useEffect } from 'react';
import './HR.css';
import { FiPlus, FiTrash2, FiCheck, FiX, FiClock } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser, hasMinRole } from '../contexts/UserContext';

const TIPOS = [
  { value: 'vacaciones',        label: 'Vacaciones',          conGoce: true  },
  { value: 'enfermedad',        label: 'Enfermedad',          conGoce: true  },
  { value: 'permiso_con_goce',  label: 'Permiso con goce',    conGoce: true  },
  { value: 'permiso_sin_goce',  label: 'Permiso sin goce',    conGoce: false },
  { value: 'licencia',          label: 'Licencia',            conGoce: true  },
];

const MESES = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const MOTIVO_MAX = 500;
const MAX_DIAS = 365;

const todayLocal = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

function calcDias(inicio, fin) {
  if (!inicio || !fin) return 1;
  const ms = new Date(fin) - new Date(inicio);
  if (!Number.isFinite(ms)) return 1;
  const d = Math.round(ms / 86400000) + 1;
  return Math.max(1, d);
}

function calcHoras(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return 0;
  const [h1, m1] = horaInicio.split(':').map(Number);
  const [h2, m2] = horaFin.split(':').map(Number);
  const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  return Math.max(0, Math.round(mins / 60 * 10) / 10);
}

async function parseError(res, fallback) {
  try {
    const data = await res.json();
    return data?.message || fallback;
  } catch {
    return fallback;
  }
}

function HrPermisos() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const userRole = currentUser?.rol || 'trabajador';
  const canApprove = hasMinRole(userRole, 'supervisor');
  const canDelete  = hasMinRole(userRole, 'encargado');

  const today = todayLocal();
  const [permisos, setPermisos] = useState([]);
  const [users, setUsers] = useState([]);
  const [mes, setMes] = useState(today.slice(5, 7));
  const [anio, setAnio] = useState(today.slice(0, 4));
  const [filtroTrabajador, setFiltroTrabajador] = useState('');
  const [toast, setToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const [esParcial, setEsParcial] = useState(false);
  const [form, setForm] = useState({
    trabajadorId: '',
    tipo: 'permiso_con_goce',
    fechaInicio: today,
    fechaFin:    today,
    horaInicio:  '08:00',
    horaFin:     '12:00',
    motivo: '',
  });

  const fetchPermisos = async () => {
    try {
      const r = await apiFetch('/api/hr/permisos');
      if (!r.ok) throw new Error();
      const data = await r.json();
      setPermisos(Array.isArray(data) ? data : []);
    } catch {
      showToast('Error al cargar permisos.', 'error');
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch('/api/users');
        if (!r.ok) throw new Error();
        const data = await r.json();
        setUsers(Array.isArray(data) ? data : []);
      } catch {
        showToast('Error al cargar trabajadores.', 'error');
      }
    })();
    fetchPermisos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tipoInfo = TIPOS.find(t => t.value === form.tipo);
  const dias  = calcDias(form.fechaInicio, form.fechaFin);
  const horas = calcHoras(form.horaInicio, form.horaFin);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const validate = () => {
    if (!form.trabajadorId) return 'Selecciona un trabajador.';
    if (!TIPOS.some(t => t.value === form.tipo)) return 'Tipo de permiso inválido.';
    if (!form.fechaInicio) return 'Fecha inicio requerida.';
    if (esParcial) {
      if (!form.horaInicio || !form.horaFin) return 'Hora inicio y fin son requeridas.';
      if (horas <= 0) return 'La hora de fin debe ser posterior a la hora de inicio.';
      if (horas > 24) return 'Las horas no pueden exceder 24.';
    } else {
      if (!form.fechaFin) return 'Fecha fin requerida.';
      if (form.fechaFin < form.fechaInicio) return 'La fecha fin no puede ser anterior a la fecha inicio.';
      if (dias > MAX_DIAS) return `El rango no puede exceder ${MAX_DIAS} días.`;
    }
    if (form.motivo && form.motivo.length > MOTIVO_MAX) {
      return `El motivo no puede exceder ${MOTIVO_MAX} caracteres.`;
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const err = validate();
    if (err) { showToast(err, 'error'); return; }

    const worker = users.find(u => u.id === form.trabajadorId);
    const conGoce = TIPOS.find(t => t.value === form.tipo)?.conGoce ?? true;
    const payload = {
      trabajadorId: form.trabajadorId,
      trabajadorNombre: worker?.nombre || '',
      tipo: form.tipo,
      fechaInicio: form.fechaInicio,
      motivo: form.motivo.trim().slice(0, MOTIVO_MAX),
      conGoce,
      esParcial,
      ...(esParcial
        ? { fechaFin: form.fechaInicio, dias: 0, horas, horaInicio: form.horaInicio, horaFin: form.horaFin }
        : { fechaFin: form.fechaFin, dias, horas: 0, horaInicio: null, horaFin: null }),
    };

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/hr/permisos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        showToast(await parseError(res, 'Error al registrar permiso.'), 'error');
        return;
      }
      await fetchPermisos();
      setForm(prev => ({ ...prev, trabajadorId: '', motivo: '' }));
      showToast('Permiso registrado.');
    } catch {
      showToast('Error al registrar permiso.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEstado = async (id, estado) => {
    if (pendingId) return;
    setPendingId(id);
    try {
      const res = await apiFetch(`/api/hr/permisos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      });
      if (!res.ok) {
        showToast(await parseError(res, 'Error al actualizar permiso.'), 'error');
        return;
      }
      await fetchPermisos();
      showToast(`Permiso ${estado}.`);
    } catch {
      showToast('Error al actualizar permiso.', 'error');
    } finally {
      setPendingId(null);
    }
  };

  const handleDelete = async (id) => {
    if (pendingId) return;
    if (!window.confirm('¿Eliminar este permiso? Esta acción no se puede deshacer.')) return;
    setPendingId(id);
    try {
      const res = await apiFetch(`/api/hr/permisos/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast(await parseError(res, 'Error al eliminar.'), 'error');
        return;
      }
      await fetchPermisos();
      showToast('Permiso eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    } finally {
      setPendingId(null);
    }
  };

  const toggleParcial = () => setEsParcial(v => !v);
  const handleToggleKey = (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggleParcial();
    }
  };

  const visibles = permisos.filter(p => {
    if (!p.fechaInicio) return false;
    const fecha = new Date(p.fechaInicio);
    if (Number.isNaN(fecha.getTime())) return false;
    const mMatch = String(fecha.getMonth() + 1).padStart(2, '0') === mes;
    const yMatch = String(fecha.getFullYear()) === anio;
    const wMatch = !filtroTrabajador || p.trabajadorId === filtroTrabajador;
    return mMatch && yMatch && wMatch;
  });

  const stats = {
    pendiente: visibles.filter(p => p.estado === 'pendiente').length,
    aprobado:  visibles.filter(p => p.estado === 'aprobado').length,
    rechazado: visibles.filter(p => p.estado === 'rechazado').length,
    sinGoce:   visibles.filter(p => p.estado === 'aprobado' && !p.conGoce).length,
  };

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Formulario ── */}
      <div className="form-card">
        <h2>Registrar Permiso o Ausencia</h2>
        <form onSubmit={handleSubmit} className="lote-form">

          <div className="hr-parcial-toggle">
            <label className="hr-toggle-label">
              <div
                className={`hr-toggle-switch ${esParcial ? 'hr-toggle-switch--on' : ''}`}
                onClick={toggleParcial}
                role="switch"
                aria-checked={esParcial}
                tabIndex={0}
                onKeyDown={handleToggleKey}
              >
                <span className="hr-toggle-knob" />
              </div>
              <FiClock size={14} />
              Permiso por horas (parcial)
            </label>
          </div>

          <div className="form-grid">
            <div className="form-control">
              <label>Trabajador</label>
              <select name="trabajadorId" value={form.trabajadorId} onChange={handleChange} required>
                <option value="">-- Seleccionar --</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div className="form-control">
              <label>Tipo de permiso</label>
              <select name="tipo" value={form.tipo} onChange={handleChange}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-control">
              <label>{esParcial ? 'Fecha' : 'Fecha inicio'}</label>
              <input type="date" name="fechaInicio" value={form.fechaInicio} onChange={handleChange} required />
            </div>

            {esParcial ? (
              <>
                <div className="form-control">
                  <label>Hora inicio</label>
                  <input type="time" name="horaInicio" value={form.horaInicio} onChange={handleChange} required />
                </div>
                <div className="form-control">
                  <label>Hora fin</label>
                  <input type="time" name="horaFin" value={form.horaFin} onChange={handleChange} required />
                </div>
              </>
            ) : (
              <div className="form-control">
                <label>Fecha fin</label>
                <input
                  type="date" name="fechaFin" value={form.fechaFin}
                  min={form.fechaInicio} onChange={handleChange} required
                />
              </div>
            )}

            <div className="form-control">
              <label>Motivo (opcional)</label>
              <input
                type="text" name="motivo" value={form.motivo}
                onChange={handleChange} placeholder="Descripción breve..."
                maxLength={MOTIVO_MAX}
              />
            </div>
          </div>

          <div className="hr-permiso-preview">
            {esParcial ? (
              <span>
                <FiClock size={13} style={{ marginRight: 4 }} />
                <strong>{horas}</strong> {horas === 1 ? 'hora' : 'horas'}
              </span>
            ) : (
              <span><strong>{dias}</strong> {dias === 1 ? 'día' : 'días'}</span>
            )}
            <span className={`status-badge status-badge--${tipoInfo?.conGoce ? 'aprobado' : 'rechazado'}`}>
              {tipoInfo?.conGoce ? 'Con goce de salario' : 'Sin goce de salario'}
            </span>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <FiPlus /> {submitting ? 'Registrando…' : 'Registrar'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Lista ── */}
      <div className="list-card">
        <h2>Permisos Registrados</h2>

        <div className="hr-filters">
          <select value={mes} onChange={e => setMes(e.target.value)}>
            {MESES.map(m => (
              <option key={m} value={m}>
                {new Date(2000, Number(m) - 1).toLocaleString('es-ES', { month: 'long' })}
              </option>
            ))}
          </select>
          <select value={anio} onChange={e => setAnio(e.target.value)}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={filtroTrabajador} onChange={e => setFiltroTrabajador(e.target.value)}>
            <option value="">Todos los trabajadores</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>

        <div className="hr-stats">
          <div className="hr-stat-card">
            <div className="hr-stat-value">{stats.pendiente}</div>
            <div className="hr-stat-label">Pendientes</div>
          </div>
          <div className="hr-stat-card">
            <div className="hr-stat-value">{stats.aprobado}</div>
            <div className="hr-stat-label">Aprobados</div>
          </div>
          <div className="hr-stat-card">
            <div className="hr-stat-value">{stats.rechazado}</div>
            <div className="hr-stat-label">Rechazados</div>
          </div>
          <div className="hr-stat-card">
            <div className="hr-stat-value" style={{ color: '#ff5050' }}>{stats.sinGoce}</div>
            <div className="hr-stat-label">Sin goce aprobados</div>
          </div>
        </div>

        <ul className="info-list">
          {visibles.map(p => {
            const tipoLabel = TIPOS.find(t => t.value === p.tipo)?.label || p.tipo;
            const conGoce   = p.conGoce !== false;
            const fecha = p.fechaInicio
              ? new Date(p.fechaInicio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
              : '';
            let duracion = '';
            if (p.esParcial) {
              duracion = `${p.horaInicio || ''} – ${p.horaFin || ''} (${p.horas} ${p.horas === 1 ? 'hora' : 'horas'})`;
            } else if (p.fechaInicio && p.fechaFin) {
              const inicio = new Date(p.fechaInicio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
              const fin    = new Date(p.fechaFin).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
              duracion = `${inicio} → ${fin} (${p.dias} ${p.dias === 1 ? 'día' : 'días'})`;
            }
            const busy = pendingId === p.id;
            return (
              <li key={p.id}>
                <div>
                  <div className="item-main-text">
                    {p.trabajadorNombre}
                    {p.esParcial && (
                      <span className="status-badge hr-badge-parcial">
                        <FiClock size={10} style={{ marginRight: 3 }} />parcial
                      </span>
                    )}
                    <span className={`status-badge status-badge--${p.estado}`}>{p.estado}</span>
                    <span className={`status-badge status-badge--${conGoce ? 'aprobado' : 'rechazado'}`}>
                      {conGoce ? 'con goce' : 'sin goce'}
                    </span>
                  </div>
                  <div className="item-sub-text">
                    {tipoLabel} · {p.esParcial ? fecha + ' · ' : ''}{duracion}
                    {p.motivo && ` · ${p.motivo}`}
                  </div>
                </div>
                <div className="lote-actions">
                  {canApprove && p.estado === 'pendiente' && (
                    <>
                      <button
                        onClick={() => handleEstado(p.id, 'aprobado')}
                        disabled={busy}
                        className="icon-btn btn-approve" title="Aprobar"
                      >
                        <FiCheck size={16} />
                      </button>
                      <button
                        onClick={() => handleEstado(p.id, 'rechazado')}
                        disabled={busy}
                        className="icon-btn btn-reject" title="Rechazar"
                      >
                        <FiX size={16} />
                      </button>
                    </>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(p.id)}
                      disabled={busy}
                      className="icon-btn delete" title="Eliminar"
                    >
                      <FiTrash2 size={18} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {visibles.length === 0 && <p className="empty-state">Sin permisos para este período.</p>}
      </div>
    </div>
  );
}

export default HrPermisos;
