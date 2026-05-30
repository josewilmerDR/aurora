import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FiClock, FiAlertTriangle, FiInbox, FiPlus, FiPackage, FiRefreshCw } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { translateApiError } from '../../../lib/errorMessages';
import { useUser } from '../../../contexts/UserContext';
import {
  getTaskStatus, isCountableTask, readIdSet, archivedTasksKey, dismissedTasksKey,
} from '../../tasks/lib/taskStatus';
import { EVENT_LABELS, resolveEventKey, timeAgo, avatarInitial } from '../lib/feedFormat';
import OnboardingChecklist from '../components/OnboardingChecklist';
import EmptyState from '../../../components/ui/EmptyState';
import '../styles/dashboard.css';

function FeedEvent({ event }) {
  const isAutopilot = event.eventType?.startsWith('autopilot_');
  const { text, icon } = EVENT_LABELS[resolveEventKey(event)] || EVENT_LABELS.notificacion;
  const initial = avatarInitial(event);
  const relTime = timeAgo(event.timestamp);
  // Autopilot no tiene userName humano: mostramos "Aurora" como autor.
  const author = event.userName?.trim() || (isAutopilot ? 'Aurora' : 'Alguien');

  return (
    <div className={`aur-row dash-feed-row${isAutopilot ? ' is-autopilot' : ''}`}>
      <div className="dash-feed-avatar" aria-hidden="true">{initial}</div>
      <div className="dash-feed-body">
        <span className="dash-feed-username">{author}</span>
        {' '}<span className="dash-feed-action">{text}</span>
        {event.title && <span className="dash-feed-title"> — {event.title}</span>}
        {event.loteNombre && event.eventType !== 'lote_created' && (
          <span className="dash-feed-sub"> · {event.loteNombre}</span>
        )}
      </div>
      {relTime && <div className="dash-feed-time">{relTime}</div>}
      <div className="dash-feed-icon" aria-hidden="true">{icon}</div>
    </div>
  );
}

function Dashboard() {
  const apiFetch = useApiFetch();
  const { firebaseUser } = useUser();
  const uid = firebaseUser?.uid || 'guest';

  const [stats, setStats] = useState({ overdue: 0, pending: 0, lowStock: 0 });
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // `reloadKey` permite reintentar tras un error sin recargar la página.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Lee la respuesta validando el status: un 4xx/5xx con cuerpo {code,...}
    // ya NO se cuela como JSON "exitoso" (antes un 403 se veía como finca
    // vacía). Las requests opcionales degradan a null en vez de romper todo.
    const fetchJson = async (url, { optional = false } = {}) => {
      const res = await apiFetch(url);
      if (!res.ok) {
        if (optional) return null;
        let body = null;
        try { body = await res.json(); } catch { /* cuerpo vacío o no-JSON */ }
        const err = new Error(translateApiError(body));
        err.handled = true; // mensaje ya traducido y seguro para mostrar
        throw err;
      }
      return res.json();
    };

    Promise.all([
      fetchJson('/api/tasks'),
      fetchJson('/api/feed'),
      fetchJson('/api/productos', { optional: true }).catch(() => null),
    ]).then(([tasksData, feedData, productosData]) => {
      if (cancelled) return;

      // Excluimos las mismas tareas que TaskTracking oculta (archivadas +
      // eliminadas del panel) para que el conteo del Dashboard coincida con
      // lo que el usuario ve al hacer click en la card.
      const hiddenIds = new Set([
        ...readIdSet(archivedTasksKey(uid)),
        ...readIdSet(dismissedTasksKey(uid)),
      ]);

      const taskStats = { overdue: 0, pending: 0, lowStock: 0 };
      (Array.isArray(tasksData) ? tasksData : [])
        .filter(task => isCountableTask(task) && !hiddenIds.has(task.id))
        .forEach(task => {
          const status = getTaskStatus(task);
          if (status === 'overdue') taskStats.overdue++;
          else if (status === 'pending') taskStats.pending++;
        });
      if (Array.isArray(productosData)) {
        taskStats.lowStock = productosData.filter(p => p.stockActual <= p.stockMinimo).length;
      }

      setStats(taskStats);
      setFeed(Array.isArray(feedData) ? feedData : []);
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      console.error('Error fetching dashboard data:', err?.message || err);
      setError(err?.handled ? err.message : 'No se pudieron cargar los datos del dashboard.');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [apiFetch, uid, reloadKey]);

  // Cards de tareas/stock — derivadas de stats para no repetir markup.
  const statCards = useMemo(() => ([
    {
      to: '/tasks?filter=overdue',
      modifier: 'dash-stat-card--danger',
      Icon: FiAlertTriangle,
      count: stats.overdue,
      label: 'Tareas vencidas',
    },
    {
      to: '/tasks?filter=pending',
      modifier: 'dash-stat-card--warn',
      Icon: FiClock,
      count: stats.pending,
      label: 'Tareas pendientes',
    },
    {
      to: '/bodega/agroquimicos/existencias',
      modifier: 'dash-stat-card--warn',
      Icon: FiPackage,
      count: stats.lowStock,
      label: 'Productos en stock bajo',
    },
  ]), [stats]);

  return (
    <div className="aur-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title">Dashboard</h2>
          <p className="aur-sheet-subtitle">
            Resumen de tareas pendientes y actividad reciente de la finca.
          </p>
        </div>
      </header>

      {loading && <div className="aur-page-loading" role="status" aria-label="Cargando dashboard" />}

      {!loading && error && (
        <EmptyState
          variant="default"
          icon={FiAlertTriangle}
          title={error}
          subtitle="Revisá tu conexión e intentá de nuevo."
          action={
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => setReloadKey(k => k + 1)}
            >
              <FiRefreshCw size={14} /> Reintentar
            </button>
          }
        />
      )}

      {!loading && !error && (
        <>
          {/* ── Stats: indicadores accionables ─────────────────────────
              Cards que ligan el Dashboard con los módulos donde se
              actúa: tareas vencidas/pendientes → /tasks, stock bajo →
              existencias, y un acceso directo para crear una nueva tarea. */}
          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num" aria-hidden="true"><FiInbox size={14} /></span>
              <h3 className="aur-section-title">Resumen</h3>
            </div>
            <div className="dash-stats-grid">
              {statCards.map(({ to, modifier, Icon, count, label }) => (
                <Link
                  key={to}
                  to={to}
                  className={`dash-stat-card ${modifier}`}
                  aria-label={`${count} ${label}`}
                >
                  <span className="dash-stat-icon" aria-hidden="true"><Icon size={18} /></span>
                  <span className="dash-stat-count">{count}</span>
                  <span className="dash-stat-label">{label}</span>
                </Link>
              ))}
              <Link
                to="/tasks?new=1"
                className="dash-stat-card dash-stat-card--accent dash-stat-card--action"
                aria-label="Crear una nueva tarea"
              >
                <span className="dash-stat-icon" aria-hidden="true"><FiPlus size={18} /></span>
                <span className="dash-stat-label">Nueva tarea</span>
              </Link>
            </div>
          </section>

          {/* ── Feed: actividad reciente ───────────────────────────────── */}
          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num" aria-hidden="true"><FiClock size={14} /></span>
              <h3 className="aur-section-title">Actividad reciente</h3>
              {feed.length > 0 && (
                <span className="aur-section-count">{feed.length}</span>
              )}
            </div>
            {feed.length > 0 ? (
              <div className="aur-list">
                {feed.map(event => <FeedEvent key={event.id} event={event} />)}
              </div>
            ) : (
              <EmptyState
                variant="compact"
                icon={FiClock}
                title="Aún no hay actividad registrada"
                subtitle="Las acciones recientes del equipo y de Aurora aparecerán aquí."
              />
            )}
          </section>

          {/* ── Onboarding inline: sólo en la primera visita; tras cerrarlo
              el componente cede el render al FAB global montado en App.jsx. */}
          <OnboardingChecklist mode="inline" />
        </>
      )}
    </div>
  );
}

export default Dashboard;
