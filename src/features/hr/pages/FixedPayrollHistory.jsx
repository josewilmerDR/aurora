import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiEye, FiFileText, FiX, FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { ROLE_LABELS } from '../../../contexts/UserContext';
import EmptyState from '../../../components/ui/EmptyState';
import { fmtSigned } from '../lib/payroll-format';
import { getInitials } from '../lib/employeeProfileShared';
import '../styles/hr.css';

const SEARCH_MAX  = 100;
// Persistimos selección y última fila vista para restaurar contexto al volver
// del reporte (la ruta /reporte desmonta el hub, así que el state se pierde).
const SELECTED_KEY = 'aurora_fph_selected';
const LASTVIEW_KEY = 'aurora_fph_last_viewed';

// Badge de estado — mismas reglas que el editor, encapsuladas para no repetir
// la cadena de ternarios en cada fila.
function estadoBadge(estado) {
  if (estado === 'pendiente') return <span className="planilla-badge planilla-badge--pendiente">Pendiente</span>;
  if (estado === 'aprobada')  return <span className="planilla-badge planilla-badge--aprobada">Aprobada</span>;
  if (estado === 'pagada' || estado === 'pagado') return <span className="planilla-badge planilla-badge--pagada">Pagada</span>;
  return <span className="planilla-badge planilla-badge--otro">{estado || '—'}</span>;
}

function FixedPayrollHistory() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [users, setUsers]         = useState([]);
  const [planillas, setPlanillas] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [usersError, setUsersError]         = useState(false);
  const [planillasError, setPlanillasError] = useState(false);
  const [selectedId, setSelectedId] = useState(() => {
    try { return sessionStorage.getItem(SELECTED_KEY) || null; } catch { return null; }
  });
  const [search, setSearch]           = useState('');
  const [highlightId, setHighlightId] = useState(null);
  const searchRef = useRef(null);

  // Carga reutilizable: cada endpoint se resuelve por separado (allSettled) para
  // degradar parcialmente — si fallan las planillas igual mostramos la lista de
  // empleados, y viceversa.
  const loadData = useCallback(() => {
    setLoading(true);
    setUsersError(false);
    setPlanillasError(false);
    Promise.allSettled([
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/hr/planilla-fijo').then(r => r.json()),
    ]).then(([uRes, pRes]) => {
      if (uRes.status === 'fulfilled' && Array.isArray(uRes.value)) {
        setUsers(uRes.value.slice().sort((a, b) =>
          (a.nombre || '').localeCompare(b.nombre || '', 'es')));
      } else {
        setUsersError(true);
        console.error('Error cargando empleados:', uRes.reason);
      }
      if (pRes.status === 'fulfilled' && Array.isArray(pRes.value)) {
        setPlanillas(pRes.value);
      } else {
        setPlanillasError(true);
        console.error('Error cargando planillas:', pRes.reason);
      }
      setLoading(false);
    });
  }, [apiFetch]);

  useEffect(() => { loadData(); }, [loadData]);

  // Al volver del reporte resaltamos brevemente la fila recién vista.
  useEffect(() => {
    let timer;
    try {
      const last = sessionStorage.getItem(LASTVIEW_KEY);
      if (last) {
        setHighlightId(last);
        sessionStorage.removeItem(LASTVIEW_KEY);
        timer = setTimeout(() => setHighlightId(null), 2600);
      }
    } catch { /* sessionStorage no disponible */ }
    return () => clearTimeout(timer);
  }, []);

  // Index: trabajadorId → planilla[] (una pasada sobre `planillas`).
  // Reemplaza dos recorridos O(N×M) por lookups O(1) en render.
  const planillasByUser = useMemo(() => {
    const map = new Map();
    for (const p of planillas) {
      const seen = new Set();
      for (const f of (p.filas || [])) {
        if (f?.trabajadorId && !seen.has(f.trabajadorId)) {
          seen.add(f.trabajadorId);
          if (!map.has(f.trabajadorId)) map.set(f.trabajadorId, []);
          map.get(f.trabajadorId).push(p);
        }
      }
    }
    return map;
  }, [planillas]);

  // Solo empleados de planilla (o quien tenga planillas históricas aunque hoy
  // ya no lleve el flag). Evita listar usuarios solo-acceso bajo "Empleados".
  const empleados = useMemo(
    () => users.filter(u => u.empleadoPlanilla || planillasByUser.has(u.id)),
    [users, planillasByUser]
  );

  const searchNorm = search.trim().toLowerCase();
  const filteredUsers = useMemo(
    () => (searchNorm
      ? empleados.filter(u => (u.nombre || '').toLowerCase().includes(searchNorm))
      : empleados),
    [empleados, searchNorm]
  );

  const selectedUser = useMemo(
    () => users.find(u => u.id === selectedId) || null,
    [users, selectedId]
  );

  // Planillas del empleado, más recientes primero.
  const empleadoPlanillas = useMemo(() => {
    if (!selectedId) return [];
    return (planillasByUser.get(selectedId) || [])
      .slice()
      .sort((a, b) => (b.periodoInicio || '').localeCompare(a.periodoInicio || ''));
  }, [selectedId, planillasByUser]);

  const acumuladoNeto = useMemo(
    () => empleadoPlanillas.reduce((s, p) => {
      const fila = p.filas?.find(f => f.trabajadorId === selectedId);
      return s + (Number(fila?.totalNeto) || 0);
    }, 0),
    [empleadoPlanillas, selectedId]
  );

  const handleSelect = (id) => {
    setSelectedId(id);
    try { sessionStorage.setItem(SELECTED_KEY, id); } catch { /* ignore */ }
  };

  const clearSearch = () => {
    setSearch('');
    searchRef.current?.focus();
  };

  const handleVerPlanilla = (p) => {
    const filaEmpleado = (p.filas || []).filter(f => f.trabajadorId === selectedId);
    const data = {
      periodoInicio:     p.periodoInicio,
      periodoFin:        p.periodoFin,
      periodoLabel:      p.periodoLabel,
      totalGeneral:      filaEmpleado.reduce((s, f) => s + (Number(f.totalNeto) || 0), 0),
      filas:             filaEmpleado,
      numeroConsecutivo: p.numeroConsecutivo || null,
    };
    try {
      sessionStorage.setItem('aurora_planilla_reporte', JSON.stringify(data));
      // Volvemos al MISMO tab (historial), no al editor, para no perder contexto.
      sessionStorage.setItem('aurora_planilla_reporte_origin', '/hr/planilla/fijo?tab=historial');
      sessionStorage.setItem(LASTVIEW_KEY, p.id);
    } catch (err) {
      // Private mode / quota exceeded — navigation continues; the report will
      // show the "no data" state handled in FixedPayrollReport.
      console.warn('Failed to persist report to sessionStorage:', err);
    }
    navigate('/hr/planilla/fijo/reporte');
  };

  return (
    <div className="ficha-page-layout">

      {/* Anuncio para lector de pantalla del empleado seleccionado */}
      <span className="aur-sr-only" aria-live="polite">
        {selectedUser ? `Mostrando planillas de ${selectedUser.nombre}` : ''}
      </span>

      {/* ── Left: planilla list for selected employee ── */}
      <div>
        {loading ? (
          <div className="form-card"><div className="aur-page-loading" /></div>
        ) : !selectedUser ? (
          <div className="form-card">
            <EmptyState
              icon={FiFileText}
              title="Selecciona un empleado"
              subtitle="Elegí a alguien de la lista para ver el historial de sus planillas."
            />
          </div>
        ) : (
          <div className="form-card">
            {/* Employee header */}
            <div className="ficha-header">
              <div className="ficha-avatar">
                {getInitials(selectedUser.nombre)}
              </div>
              <div>
                <div className="ficha-worker-name">{selectedUser.nombre}</div>
                <div className="ficha-worker-role">{ROLE_LABELS[selectedUser.rol] || selectedUser.rol}</div>
              </div>
            </div>

            <h2 style={{ marginTop: 0, marginBottom: 4 }}>Planillas del empleado</h2>
            <p className="fph-detail-sub">
              {empleadoPlanillas.length > 0
                ? <>{empleadoPlanillas.length} planilla{empleadoPlanillas.length !== 1 ? 's' : ''} · acumulado neto <strong>{fmtSigned(acumuladoNeto)}</strong>. Para aprobar, pagar o eliminar, usá el tab <strong>Editor</strong>.</>
                : <>Para aprobar, pagar o eliminar planillas, usá el tab <strong>Editor</strong>.</>}
            </p>

            {planillasError ? (
              <EmptyState
                icon={FiAlertTriangle}
                title="No se pudo cargar el historial"
                subtitle="Revisá tu conexión e intentá de nuevo."
                action={<button className="aur-btn-pill aur-btn-pill--sm" onClick={loadData}><FiRefreshCw size={14} /> Reintentar</button>}
              />
            ) : empleadoPlanillas.length === 0 ? (
              <EmptyState
                icon={FiFileText}
                title="Sin planillas registradas"
                subtitle="Este empleado aún no aparece en ninguna planilla guardada."
              />
            ) : (
              <div className="fph-hist-list">
                <div className="fph-hist-header">
                  <div>Período</div>
                  <div>Total Neto</div>
                  <div>Estado</div>
                  <div></div>
                </div>
                {empleadoPlanillas.map(p => {
                  const fila = p.filas?.find(f => f.trabajadorId === selectedId);
                  return (
                    <div
                      key={p.id}
                      className={`fph-hist-row${highlightId === p.id ? ' fph-hist-row--highlight' : ''}`}
                    >
                      <div className="fph-hist-periodo">
                        <span className="fph-hist-periodo-label">{p.periodoLabel}</span>
                        {p.numeroConsecutivo && <span className="fph-hist-num">N° {p.numeroConsecutivo}</span>}
                      </div>
                      <div className="fph-hist-total">
                        {fila ? fmtSigned(fila.totalNeto) : '—'}
                      </div>
                      <div>{estadoBadge(p.estado)}</div>
                      <div className="fph-hist-actions">
                        <button
                          className="aur-btn-text"
                          onClick={() => handleVerPlanilla(p)}
                          aria-label={`Ver planilla ${p.periodoLabel}`}
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
          <span className="empleados-panel-count">
            {searchNorm ? `${filteredUsers.length}/${empleados.length}` : empleados.length}
          </span>
        </div>

        {/* Search — misma primitiva que EmployeeListPanel (clear + aria-label) */}
        <div className="empleados-search-wrap">
          <input
            ref={searchRef}
            type="text"
            className="empleados-search"
            placeholder="Buscar empleado..."
            maxLength={SEARCH_MAX}
            value={search}
            aria-label="Buscar empleado"
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape' && search) { e.preventDefault(); clearSearch(); } }}
          />
          {search && (
            <button
              type="button"
              className="empleados-search-clear"
              onClick={clearSearch}
              aria-label="Limpiar búsqueda"
            >
              <FiX size={14} />
            </button>
          )}
        </div>

        {loading ? (
          <div className="aur-page-loading" />
        ) : usersError ? (
          <EmptyState
            variant="compact"
            icon={FiAlertTriangle}
            title="No se pudieron cargar los empleados"
            subtitle="Revisá tu conexión."
            action={<button className="aur-btn-pill aur-btn-pill--sm" onClick={loadData}><FiRefreshCw size={14} /> Reintentar</button>}
          />
        ) : (
          <ul className="empleados-list">
            {filteredUsers.map(u => {
              const count = planillasByUser.get(u.id)?.length || 0;
              const isActive = selectedId === u.id;
              return (
                <li
                  key={u.id}
                  className={`empleados-list-item${isActive ? ' empleados-list-item--active' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isActive}
                  onClick={() => handleSelect(u.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(u.id); } }}
                >
                  <div className="empleados-list-avatar">
                    {getInitials(u.nombre)}
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
            {filteredUsers.length === 0 && (
              <li className="empleados-list-empty">
                {empleados.length === 0
                  ? 'No hay empleados en planilla.'
                  : `Ningún empleado coincide con “${search.trim()}”.`}
              </li>
            )}
          </ul>
        )}
      </div>

    </div>
  );
}

export default FixedPayrollHistory;
