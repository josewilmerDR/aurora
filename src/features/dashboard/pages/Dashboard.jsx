import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
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
    <div className={`feed-event${isAutopilot ? ' feed-event--autopilot' : ''}`}>
      <div className={`feed-avatar${isAutopilot ? ' feed-avatar--autopilot' : ''}`}>{initial}</div>
      <div className="feed-body">
        <span className={`feed-username${isAutopilot ? ' feed-username--autopilot' : ''}`}>{event.userName}</span>
        {' '}<span className="feed-action">{text}</span>
        {event.title && <span className="feed-title"> — {event.title}</span>}
        {event.loteNombre && event.eventType !== 'lote_created' && (
          <span className="feed-sub"> · {event.loteNombre}</span>
        )}
      </div>
      <div className="feed-time">{timeAgo(event.timestamp)}</div>
      <div className="feed-icon">{icon}</div>
    </div>
  );
}

function Dashboard() {
  const apiFetch = useApiFetch();
  const { firebaseUser } = useUser();
  const [stats, setStats] = useState({ overdue: 0, pending: 0 });
  const [stockBajoCount, setStockBajoCount] = useState(0);
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      apiFetch('/api/productos').then(res => res.json()),
      apiFetch('/api/feed').then(res => res.json()),
    ]).then(([tasksData, productosData, feedData]) => {
      const archivedIds = new Set(
        JSON.parse(localStorage.getItem(`aurora_archived_tasks_${firebaseUser?.uid || 'guest'}`) || '[]')
      );

      const taskStats = { overdue: 0, pending: 0 };
      tasksData
        .filter(task => task.type !== 'REMINDER_3_DAY' && task.status !== 'skipped' && !archivedIds.has(task.id))
        .forEach(task => {
          const status = getTaskStatus(task);
          if (status === 'overdue') taskStats.overdue++;
          else if (status === 'pending') taskStats.pending++;
        });

      setStats(taskStats);
      setStockBajoCount(productosData.filter(p => p.activo !== false && p.stockActual <= p.stockMinimo).length);
      setFeed(Array.isArray(feedData) ? feedData : []);
      setLoading(false);
    }).catch(err => {
      console.error("Error fetching dashboard data:", err);
      setError("No se pudieron cargar los datos del dashboard.");
      setLoading(false);
    });
  }, [firebaseUser?.uid]);

  if (loading) return <div>Cargando...</div>;
  if (error) return <div className="empty-state">{error}</div>;

  return (
    <div>
      <div className="dashboard-grid">
        <Link to="/tasks?filter=overdue" className="stat-card overdue">
          <div className="count">{stats.overdue}</div>
          <div className="label">Tareas Vencidas</div>
        </Link>
        <Link to="/tasks?filter=pending" className="stat-card pending">
          <div className="count">{stats.pending}</div>
          <div className="label">Tareas Pendientes</div>
        </Link>
        <Link to="/productos" className="stat-card stock-bajo">
          <div className="count">{stockBajoCount}</div>
          <div className="label">Stock Bajo</div>
        </Link>
      </div>

      <div className="feed-card">
        <h3 className="feed-header">Actividad reciente</h3>
        {feed.length > 0 ? (
          feed.map(event => <FeedEvent key={event.id} event={event} />)
        ) : (
          <p className="empty-state">Aún no hay actividad registrada.</p>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
