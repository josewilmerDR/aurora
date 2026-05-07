import { useState, useEffect, useMemo } from 'react';
import { FiCheck, FiX, FiCalendar, FiSave, FiUsers } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import '../styles/hr.css';
import '../styles/asistencia.css';

// Estados deben coincidir con la enum del backend (functions/routes/hr/fichas.js).
const ESTADOS = [
  { value: 'presente',    label: 'Presente'    },
  { value: 'ausente',     label: 'Ausente'     },
  { value: 'vacaciones',  label: 'Vacaciones'  },
  { value: 'incapacidad', label: 'Incapacidad' },
  { value: 'permiso',     label: 'Permiso'     },
];

const NOTAS_MAX = 500;

const todayLocal = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export default function Asistencia() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const userRole = currentUser?.rol || 'trabajador';
  const canEdit = hasMinRole(userRole, 'encargado');

  const [fecha, setFecha] = useState(todayLocal());
  const [users, setUsers] = useState([]);
  // form: userId -> { estado, horasExtra, notas }
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    apiFetch('/api/users')
      .then(r => r.json())
      .then(data => {
        const sorted = (Array.isArray(data) ? data : [])
          .slice()
          .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
        setUsers(sorted);
      })
      .catch(() => setUsers([]));
  }, []);

  // Hidrata el form con la asistencia ya registrada para la fecha. La query
  // mensual del backend (mes/anio) trae más de lo necesario, así que filtro
  // el día exacto del lado del cliente.
  useEffect(() => {
    setLoading(true);
    const [y, m] = fecha.split('-').map(Number);
    apiFetch(`/api/hr/asistencia?mes=${m}&anio=${y}`)
      .then(r => r.json())
      .then(data => {
        const map = {};
        (Array.isArray(data) ? data : []).forEach(rec => {
          const recDate = (rec.fecha || '').slice(0, 10);
          if (recDate === fecha && rec.trabajadorId) {
            map[rec.trabajadorId] = {
              estado: rec.estado || '',
              horasExtra: Number(rec.horasExtra) || 0,
              notas: rec.notas || '',
            };
          }
        });
        setForm(map);
      })
      .catch(() => setForm({}))
      .finally(() => setLoading(false));
  }, [fecha]);

  const setEstado = (userId, estado) => {
    setForm(prev => {
      const cur = prev[userId] || {};
      return {
        ...prev,
        [userId]: {
          estado,
          horasExtra: estado === 'presente' ? (cur.horasExtra || 0) : 0,
          notas: cur.notas || '',
        },
      };
    });
  };

  const setHorasExtra = (userId, val) => {
    const n = Math.max(0, Math.min(24, Number(val) || 0));
    setForm(prev => ({
      ...prev,
      [userId]: { ...(prev[userId] || {}), horasExtra: n },
    }));
  };

  const setNotas = (userId, val) => {
    setForm(prev => ({
      ...prev,
      [userId]: { ...(prev[userId] || {}), notas: String(val).slice(0, NOTAS_MAX) },
    }));
  };

  const markAllPresent = () => {
    setForm(prev => {
      const next = { ...prev };
      users.forEach(u => {
        next[u.id] = {
          estado: 'presente',
          horasExtra: prev[u.id]?.horasExtra || 0,
          notas: prev[u.id]?.notas || '',
        };
      });
      return next;
    });
  };

  const clearAll = () => setForm({});

  const counts = useMemo(() => {
    const c = { presente: 0, ausente: 0, vacaciones: 0, incapacidad: 0, permiso: 0, total: 0 };
    Object.values(form).forEach(r => {
      if (!r?.estado) return;
      if (c[r.estado] !== undefined) c[r.estado]++;
      c.total++;
    });
    return c;
  }, [form]);

  const handleSave = async () => {
    if (!canEdit) return;
    const registros = Object.entries(form)
      .filter(([, r]) => r?.estado)
      .map(([trabajadorId, r]) => ({
        trabajadorId,
        estado: r.estado,
        horasExtra: r.horasExtra || 0,
        notas: r.notas || '',
      }));
    if (registros.length === 0) {
      showToast('No hay registros para guardar.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/hr/asistencia/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, registros }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || 'Error al guardar.');
      }
      const data = await res.json();
      showToast(`Asistencia guardada — ${data.saved} registros.`);
    } catch (err) {
      showToast(err.message || 'Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="asist-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="asist-header">
        <h1>Asistencia diaria</h1>
        <p className="asist-subtitle">
          Registrá la cuadrilla del día completo en una sola pantalla. Reenviar la misma fecha sobreescribe los datos previos.
        </p>
      </header>

      <section className="asist-controls">
        <label className="asist-fecha-label">
          <FiCalendar size={14} />
          <span>Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            max={todayLocal()}
          />
        </label>
        {canEdit && (
          <div className="asist-bulk-actions">
            <button type="button" onClick={markAllPresent} className="asist-bulk-btn">
              <FiCheck size={13} /> Marcar todos presentes
            </button>
            <button type="button" onClick={clearAll} className="asist-bulk-btn">
              <FiX size={13} /> Limpiar
            </button>
          </div>
        )}
      </section>

      <section className="hr-stats asist-stats">
        <div className="hr-stat-card">
          <div className="hr-stat-value">{users.length}</div>
          <div className="hr-stat-label"><FiUsers size={11} /> Trabajadores</div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-value">{counts.presente}</div>
          <div className="hr-stat-label">Presentes</div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-value">{counts.ausente}</div>
          <div className="hr-stat-label">Ausentes</div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-value">{counts.vacaciones + counts.incapacidad + counts.permiso}</div>
          <div className="hr-stat-label">Permisos / Vac. / Inc.</div>
        </div>
      </section>

      {loading ? (
        <div className="asist-loading">Cargando…</div>
      ) : users.length === 0 ? (
        <div className="empty-state">No hay trabajadores registrados.</div>
      ) : (
        <div className="asist-grid">
          {users.map(u => {
            const r = form[u.id] || {};
            return (
              <div key={u.id} className={`asist-row asist-row--${r.estado || 'empty'}`}>
                <div className="asist-name">{u.nombre || u.id}</div>
                <div className="asist-estados">
                  {ESTADOS.map(e => (
                    <button
                      key={e.value}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setEstado(u.id, e.value)}
                      className={`asist-estado-btn asist-estado-btn--${e.value}${r.estado === e.value ? ' is-active' : ''}`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
                {r.estado === 'presente' && (
                  <label className="asist-horas">
                    <span>Horas extra</span>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      value={r.horasExtra || 0}
                      onChange={e => setHorasExtra(u.id, e.target.value)}
                      disabled={!canEdit}
                    />
                  </label>
                )}
                <input
                  type="text"
                  placeholder="Notas (opcional)"
                  value={r.notas || ''}
                  onChange={e => setNotas(u.id, e.target.value)}
                  maxLength={NOTAS_MAX}
                  disabled={!canEdit}
                  className="asist-notas-input"
                />
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <div className="asist-save-bar">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || counts.total === 0}
            className="aur-btn-pill"
          >
            <FiSave size={14} /> {saving ? 'Guardando…' : `Guardar (${counts.total})`}
          </button>
        </div>
      )}
    </div>
  );
}
