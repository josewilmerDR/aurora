import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiClock, FiAlertTriangle, FiInbox, FiPlus, FiPackage } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import OnboardingChecklist from '../components/OnboardingChecklist';
import '../styles/dashboard.css';

const EVENT_LABELS = {
  aplicacion: { text: 'completó una aplicación', icon: '🧪' },
  notificacion: { text: 'completó una tarea', icon: '✓' },
  lote_created: { text: 'creó un lote', icon: '🌱' },
  autopilot_analysis: { text: 'completó un análisis', icon: '🤖' },
  autopilot_action_executed: { text: 'ejecutó una acción', icon: '⚡' },
  autopilot_action_escalated: { text: 'escaló una acción', icon: '⚠️' },
};

function timeAgo(ms) {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ahora mismo';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

function FeedEvent({ event }) {
  const isAutopilot = event.eventType?.startsWith('autopilot_');
  const key = isAutopilot ? event.eventType : (event.eventType === 'lote_created' ? 'lote_created' : (event.activityType || 'notificacion'));
  const { text, icon } = EVENT_LABELS[key] || EVENT_LABELS.notificacion;
  const initial = isAutopilot ? '⚙' : (event.userName || '?')[0].toUpperCase();

  return (
    <div className={`aur-row dash-feed-row${isAutopilot ? ' is-autopilot' : ''}`}>
      <div className="dash-feed-avatar">{initial}</div>
      <div className="dash-feed-body">
        <span className="dash-feed-username">{event.userName}</span>
        {' '}<span className="dash-feed-action">{text}</span>
        {event.title && <span className="dash-feed-title"> — {event.title}</span>}
        {event.loteNombre && event.eventType !== 'lote_created' && (
          <span className="dash-feed-sub"> · {event.loteNombre}</span>
        )}
      </div>
      <div className="dash-feed-time">{timeAgo(event.timestamp)}</div>
      <div className="dash-feed-icon">{icon}</div>
    </div>
  );
}

function Dashboard() {
  const apiFetch = useApiFetch();
  const { firebaseUser, currentUser } = useUser();
  const [stats, setStats] = useState({ overdue: 0, pending: 0, lowStock: 0 });
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const uid = firebaseUser?.uid || 'guest';
  const isAdmin = hasMinRole(currentUser?.rol, 'administrador');

  const getTaskStatus = (task) => {
    if (task.status === 'completed_by_user') return 'completed';
    const today = new Date();
    const dueDate = new Date(task.dueDate);
    const dueDateDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (dueDateDay < todayDay) return 'overdue';
    return 'pending';
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch('/api/tasks').then(res => res.json()),
      apiFetch('/api/feed').then(res => res.json()),
      apiFetch('/api/productos').then(res => res.json()).catch(() => []),
    ]).then(([tasksData, feedData, productosData]) => {
      const archivedIds = new Set(
        JSON.parse(localStorage.getItem(`aurora_archived_tasks_${firebaseUser?.uid || 'guest'}`) || '[]')
      );

      const taskStats = { overdue: 0, pending: 0, lowStock: 0 };
      tasksData
        .filter(task => task.type !== 'REMINDER_3_DAY' && task.status !== 'skipped' && !archivedIds.has(task.id))
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
      console.error("Error fetching dashboard data:", err);
      setError("No se pudieron cargar los datos del dashboard.");
      setLoading(false);
    });
  }, [firebaseUser?.uid]);

  return (
    <div className="aur-sheet dash-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h1 className="aur-sheet-title">Dashboard</h1>
          <p className="aur-sheet-subtitle">
            Resumen de tareas pendientes y actividad reciente de la finca.
          </p>
        </div>
      </header>

      {loading && <div className="aur-page-loading" />}

      {!loading && error && <div className="empty-state">{error}</div>}

      {!loading && !error && isAdmin && <OnboardingChecklist uid={uid} />}

      {!loading && !error && (
        <>
          {/* ── Stats: indicadores accionables ─────────────────────────
              Cards que ligan el Dashboard con los módulos donde se
              actúa: tareas vencidas/pendientes → /tasks, stock bajo →
              existencias, y un acceso directo para crear una nueva tarea. */}
          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num"><FiInbox size={14} /></span>
              <h3 className="aur-section-title">Resumen</h3>
            </div>
            <div className="dash-stats-grid">
              <Link to="/tasks?filter=overdue" className="dash-stat-card dash-stat-card--danger">
                <span className="dash-stat-icon"><FiAlertTriangle size={18} /></span>
                <span className="dash-stat-count">{stats.overdue}</span>
                <span className="dash-stat-label">Tareas vencidas</span>
              </Link>
              <Link to="/tasks?filter=pending" className="dash-stat-card dash-stat-card--warn">
                <span className="dash-stat-icon"><FiClock size={18} /></span>
                <span className="dash-stat-count">{stats.pending}</span>
                <span className="dash-stat-label">Tareas pendientes</span>
              </Link>
              <Link to="/bodega/agroquimicos/existencias" className="dash-stat-card dash-stat-card--warn">
                <span className="dash-stat-icon"><FiPackage size={18} /></span>
                <span className="dash-stat-count">{stats.lowStock}</span>
                <span className="dash-stat-label">Productos en stock bajo</span>
              </Link>
              <Link to="/tasks?new=1" className="dash-stat-card dash-stat-card--accent dash-stat-card--action">
                <span className="dash-stat-icon"><FiPlus size={18} /></span>
                <span className="dash-stat-label">Nueva tarea</span>
              </Link>
            </div>
          </section>

          {/* ── Feed: actividad reciente ───────────────────────────────── */}
          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num"><FiClock size={14} /></span>
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
              <div className="empty-state">Aún no hay actividad registrada.</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default Dashboard;
