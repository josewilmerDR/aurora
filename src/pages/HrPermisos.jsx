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

function calcDias(inicio, fin) {
  if (!inicio || !fin) return 1;
  const d = Math.round((new Date(fin) - new Date(inicio)) / 86400000) + 1;
  return Math.max(1, d);
}

function calcHoras(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return 0;
  const [h1, m1] = horaInicio.split(':').map(Number);
  const [h2, m2] = horaFin.split(':').map(Number);
  const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  return Math.max(0, Math.round(mins / 60 * 10) / 10);
}

function HrPermisos() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const userRole = currentUser?.rol || 'trabajador';
  const canApprove = hasMinRole(userRole, 'supervisor');

  const now = new Date();
  const [permisos, setPermisos] = useState([]);
  const [users, setUsers] = useState([]);
  const [mes, setMes] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [anio, setAnio] = useState(String(now.getFullYear()));
  const [filtroTrabajador, setFiltroTrabajador] = useState('');
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const [esParcial, setEsParcial] = useState(false);
  const [form, setForm] = useState({
    trabajadorId: '',
    tipo: 'permiso_con_goce',
    fechaInicio: now.toISOString().split('T')[0],
    fechaFin:    now.toISOString().split('T')[0],
    horaInicio:  '08:00',
    horaFin:     '12:00',
    motivo: '',
  });

  const fetchPermisos = () => {
    apiFetch('/api/hr/permisos')
      .then(r => r.json()).then(setPermisos).catch(console.error);
  };

  useEffect(() => {
    apiFetch('/api/users').then(r => r.json()).then(setUsers).catch(console.error);
    fetchPermisos();
  }, []);

  const tipoInfo = TIPOS.find(t => t.value === form.tipo);
  const dias  = calcDias(form.fechaInicio, form.fechaFin);
  const horas = calcHoras(form.horaInicio, form.horaFin);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (esParcial && horas <= 0) {
      showToast('La hora de fin debe ser posterior a la hora de inicio.', 'error');
      return;
    }
    const worker = users.find(u => u.id === form.trabajadorId);
    const conGoce = TIPOS.find(t => t.value === form.tipo)?.conGoce ?? true;
    const payload = {
      ...form,
      conGoce,
      trabajadorNombre: worker?.nombre || '',
      esParcial,
      ...(esParcial
        ? { dias: 0, horas, fechaFin: form.fechaInicio }
        : { dias, horas: 0, horaInicio: null, horaFin: null }),
    };
    try {
      const res = await apiFetch('/api/hr/permisos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      fetchPermisos();
      setForm(prev => ({ ...prev, trabajadorId: '', motivo: '' }));
      showToast('Permiso registrado.');
    } catch {
      showToast('Error al registrar permiso.', 'error');
    }
  };

  const handleEstado = async (id, estado) => {
    try {
      const res = await apiFetch(`/api/hr/permisos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      });
      if (!res.ok) throw new Error();
      fetchPermisos();
      showToast(`Permiso ${estado}.`);
    } catch {
      showToast('Error al actualizar permiso.', 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await apiFetch(`/api/hr/permisos/${id}`, { method: 'DELETE' });
      fetchPermisos();
      showToast('Permiso eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  // Filter client-side by month/year and optional worker
  const visibles = permisos.filter(p => {
    const fecha = new Date(p.fechaInicio);
    const mMatch = String(fecha.getMonth() + 1).padStart(2, '0') === mes;
    const yMatch = String(fecha.getFullYear()) === anio;
    const wMatch = !filtroTrabajador || p.trabajadorId === filtroTrabajador;
    return mMatch && yMatch && wMatch;
  });

  // Stats
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

          {/* Toggle permiso parcial */}
          <div className="hr-parcial-toggle">
            <label className="hr-toggle-label">
              <div
                className={`hr-toggle-switch ${esParcial ? 'hr-toggle-switch--on' : ''}`}
                onClick={() => setEsParcial(v => !v)}
                role="switch"
                aria-checked={esParcial}
                tabIndex={0}
                onKeyDown={e => e.key === ' ' && setEsParcial(v => !v)}
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
                <input type="date" name="fechaFin" value={form.fechaFin} onChange={handleChange} required />
              </div>
            )}

            <div className="form-control">
              <label>Motivo (opcional)</label>
              <input
                type="text" name="motivo" value={form.motivo}
                onChange={handleChange} placeholder="Descripción breve..."
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
            <button type="submit" className="btn btn-primary">
              <FiPlus /> Registrar
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
            const fecha = new Date(p.fechaInicio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
            const duracion = p.esParcial
              ? `${p.horaInicio} – ${p.horaFin} (${p.horas} ${p.horas === 1 ? 'hora' : 'horas'})`
              : (() => {
                  const inicio = new Date(p.fechaInicio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
                  const fin    = new Date(p.fechaFin).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
                  return `${inicio} → ${fin} (${p.dias} ${p.dias === 1 ? 'día' : 'días'})`;
                })();
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
                        className="icon-btn btn-approve" title="Aprobar"
                      >
                        <FiCheck size={16} />
                      </button>
                      <button
                        onClick={() => handleEstado(p.id, 'rechazado')}
                        className="icon-btn btn-reject" title="Rechazar"
                      >
                        <FiX size={16} />
                      </button>
                    </>
                  )}
                  <button onClick={() => handleDelete(p.id)} className="icon-btn delete" title="Eliminar">
                    <FiTrash2 size={18} />
                  </button>
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
