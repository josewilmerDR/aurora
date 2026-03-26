import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiEye, FiSearch, FiFileText } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './HR.css';

const fmt = (n) => `₡${Math.max(0, Math.round(Number(n))).toLocaleString('es-CR')}`;

function HrHistorialPagos() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [users, setUsers]         = useState([]);
  const [planillas, setPlanillas] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch]       = useState('');

  useEffect(() => {
    Promise.all([
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/hr/planilla-fijo').then(r => r.json()),
    ]).then(([u, p]) => {
      setUsers(u.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
      setPlanillas(p);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filteredUsers = users.filter(u =>
    !search.trim() || u.nombre.toLowerCase().includes(search.toLowerCase())
  );

  const selectedUser = users.find(u => u.id === selectedId);

  // All planillas that include this employee, sorted newest first (already from API)
  const empleadoPlanillas = selectedId
    ? planillas.filter(p => p.filas?.some(f => f.trabajadorId === selectedId))
    : [];

  const handleVerPlanilla = (p) => {
    const filaEmpleado = p.filas?.filter(f => f.trabajadorId === selectedId) || [];
    const data = {
      periodoInicio:     p.periodoInicio,
      periodoFin:        p.periodoFin,
      periodoLabel:      p.periodoLabel,
      totalGeneral:      filaEmpleado.reduce((s, f) => s + (f.totalNeto || 0), 0),
      filas:             filaEmpleado,
      numeroConsecutivo: p.numeroConsecutivo || null,
    };
    sessionStorage.setItem('aurora_planilla_reporte', JSON.stringify(data));
    sessionStorage.setItem('aurora_planilla_reporte_origin', '/hr/historial-pagos');
    navigate('/hr/planilla/fijo/reporte');
  };

  // Count planillas per employee (for the list badge)
  const planillaCount = (userId) =>
    planillas.filter(p => p.filas?.some(f => f.trabajadorId === userId)).length;

  return (
    <div className="ficha-page-layout">

      {/* ── Left: planilla list for selected employee ── */}
      <div>
        {!selectedUser ? (
          <div className="form-card">
            <div className="empty-state" style={{ padding: '60px 0' }}>
              <FiFileText size={40} style={{ opacity: 0.2, marginBottom: 16 }} />
              <p style={{ marginTop: 0 }}>Selecciona un empleado de la lista para ver su historial de planillas.</p>
            </div>
          </div>
        ) : (
          <div className="form-card">
            {/* Employee header */}
            <div className="ficha-header">
              <div className="ficha-avatar">
                {selectedUser.nombre.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="ficha-worker-name">{selectedUser.nombre}</div>
                <div className="ficha-worker-role">{selectedUser.rol}</div>
              </div>
            </div>

            <h2 style={{ marginTop: 0, marginBottom: 16 }}>Historial de Planillas</h2>

            {loading ? (
              <p style={{ opacity: 0.5 }}>Cargando...</p>
            ) : empleadoPlanillas.length === 0 ? (
              <div className="empty-state">
                <p>No hay planillas registradas para este empleado.</p>
              </div>
            ) : (
              <div className="planilla-hist-list">
                <div className="planilla-hist-header">
                  <div>Período</div>
                  <div>N°</div>
                  <div>Total Neto</div>
                  <div>Estado</div>
                  <div></div>
                </div>
                {empleadoPlanillas.map(p => {
                  const fila = p.filas?.find(f => f.trabajadorId === selectedId);
                  return (
                    <div key={p.id} className="planilla-hist-row">
                      <div className="planilla-hist-periodo">{p.periodoLabel}</div>
                      <div style={{ fontSize: '0.8rem', opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>
                        {p.numeroConsecutivo || '—'}
                      </div>
                      <div className="planilla-hist-total">
                        {fila ? fmt(fila.totalNeto) : '—'}
                      </div>
                      <div>
                        {p.estado === 'pendiente' && (
                          <span className="planilla-badge planilla-badge--pendiente">Pendiente</span>
                        )}
                        {p.estado === 'aprobada' && (
                          <span className="planilla-badge planilla-badge--aprobada">Aprobada</span>
                        )}
                        {(p.estado === 'pagada' || p.estado === 'pagado') && (
                          <span className="planilla-badge planilla-badge--pagada">Pagada</span>
                        )}
                        {!['pendiente', 'aprobada', 'pagada', 'pagado'].includes(p.estado) && (
                          <span className="planilla-badge planilla-badge--otro">{p.estado}</span>
                        )}
                      </div>
                      <div className="planilla-hist-actions">
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.82rem', padding: '5px 13px', whiteSpace: 'nowrap' }}
                          onClick={() => handleVerPlanilla(p)}
                        >
                          <FiEye size={14} /> Ver planilla
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right: A-Z employee panel ── */}
      <div className="empleados-panel">
        <div className="empleados-panel-header">
          <span>Empleados</span>
          <span className="empleados-panel-count">{users.length}</span>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--aurora-border)', position: 'relative' }}>
          <FiSearch size={13} style={{ position: 'absolute', left: 22, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
          <input
            type="text"
            placeholder="Buscar empleado..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--aurora-dark-blue)',
              border: '1px solid var(--aurora-border)',
              borderRadius: 4,
              color: 'var(--aurora-light)',
              padding: '7px 10px 7px 28px',
              fontSize: '0.85rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <ul className="empleados-list">
          {filteredUsers.map(u => {
            const count = planillaCount(u.id);
            return (
              <li
                key={u.id}
                className={`empleados-list-item${selectedId === u.id ? ' empleados-list-item--active' : ''}`}
                onClick={() => setSelectedId(u.id)}
              >
                <div className="empleados-list-avatar">
                  {u.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="empleados-list-info">
                  <div className="empleados-list-name">{u.nombre}</div>
                  <div className="empleados-list-sub">
                    {count > 0 ? `${count} planilla${count !== 1 ? 's' : ''}` : 'Sin planillas'}
                  </div>
                </div>
              </li>
            );
          })}
          {filteredUsers.length === 0 && !loading && (
            <li style={{ padding: '20px 16px', opacity: 0.4, fontSize: '0.85rem', textAlign: 'center' }}>
              Sin resultados
            </li>
          )}
        </ul>
      </div>

    </div>
  );
}

export default HrHistorialPagos;
