import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser } from '../contexts/UserContext';
import './Dashboard.css'; // Importamos los nuevos estilos del Dashboard

function Dashboard() {
  const apiFetch = useApiFetch();
  const { firebaseUser } = useUser();
  const [stats, setStats] = useState({ overdue: 0, pending: 0, completed: 0 });
  const [upcomingTasks, setUpcomingTasks] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [stockBajoCount, setStockBajoCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // La lógica para obtener el estado de la tarea se mantiene igual
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
      apiFetch('/api/lotes').then(res => res.json()),
      apiFetch('/api/productos').then(res => res.json()),
    ]).then(([tasksData, lotesData, productosData]) => {
      const archivedIds = new Set(
        JSON.parse(localStorage.getItem(`aurora_archived_tasks_${firebaseUser?.uid || 'guest'}`) || '[]')
      );

      const taskStats = { overdue: 0, pending: 0, completed: 0 };
      const pendingTasks = [];

      tasksData
        .filter(task => task.type !== 'REMINDER_3_DAY' && task.status !== 'skipped' && !archivedIds.has(task.id))
        .forEach(task => {
            const status = getTaskStatus(task);
            if (status === 'completed') taskStats.completed++;
            else if (status === 'overdue') taskStats.overdue++;
            else {
                taskStats.pending++;
                pendingTasks.push(task);
            }
        });

      pendingTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

      setStats(taskStats);
      setUpcomingTasks(pendingTasks.slice(0, 5));
      setLotes(lotesData);
      setStockBajoCount(productosData.filter(p => p.activo !== false && p.stockActual <= p.stockMinimo).length);
      setLoading(false);

    }).catch(err => {
      console.error("Error fetching dashboard data:", err);
      setError("No se pudieron cargar los datos del dashboard.");
      setLoading(false);
    });
  }, [firebaseUser?.uid]);

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (error) {
    return <div className="empty-state">{error}</div>;
  }

  return (
    <div>
      
      {/* Tarjetas de Estadísticas */}
      <div className="dashboard-grid">
        <Link to="/tasks?filter=overdue" className="stat-card overdue">
          <div className="count">{stats.overdue}</div>
          <div className="label">Tareas Vencidas</div>
        </Link>
        <Link to="/tasks?filter=pending" className="stat-card pending">
          <div className="count">{stats.pending}</div>
          <div className="label">Tareas Pendientes</div>
        </Link>
        <Link to="/tasks?filter=completed" className="stat-card completed">
          <div className="count">{stats.completed}</div>
          <div className="label">Tareas Hechas</div>
        </Link>
        <Link to="/productos" className="stat-card stock-bajo">
          <div className="count">{stockBajoCount}</div>
          <div className="label">Stock Bajo</div>
        </Link>
      </div>

      {/* Columnas de Información */}
      <div className="dashboard-columns-grid">
        <div className="info-card">
          <h3>Próximas 5 Tareas</h3>
          {upcomingTasks.length > 0 ? (
            <ul className="info-list">
              {upcomingTasks.map(task => (
                <li key={task.id}>
                  <div>
                    <div className="item-main-text">{task.activityName}</div>
                    <div className="item-sub-text">Lote: {task.loteName}</div>
                  </div>
                  <div className="item-sub-text">{new Date(task.dueDate).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">¡Todo al día!</p>
          )}
        </div>

        <div className="info-card">
          <h3>Lotes Activos</h3>
          {lotes.length > 0 ? (
            <ul className="info-list">
              {lotes.map(lote => (
                  <li key={lote.id}>
                      <div className="item-main-text">{lote.nombreLote}</div>
                      <div className="item-sub-text">
                        Creado: {new Date(lote.fechaCreacion._seconds * 1000).toLocaleDateString('es-ES', { timeZone: 'UTC' })}
                      </div>
                  </li>
              ))}
            </ul>
          ) : (
             <p className="empty-state">No hay lotes creados.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
