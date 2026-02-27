import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

function Dashboard() {
  const [stats, setStats] = useState({ overdue: 0, pending: 0, completed: 0 });
  const [upcomingTasks, setUpcomingTasks] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Lógica para determinar el estado, similar a TaskTracking
  const getTaskStatus = (task) => {
    if (task.status === 'completed_by_user') {
      return 'completed';
    }
    const today = new Date();
    const dueDate = new Date(task.dueDate._seconds * 1000);
    const dueDateDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (dueDateDay < todayDay) {
      return 'overdue';
    }
    return 'pending';
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/tasks').then(res => res.json()),
      fetch('/api/lotes').then(res => res.json())
    ]).then(([tasksData, lotesData]) => {
      
      // 1. Calcular estadísticas de tareas
      const taskStats = { overdue: 0, pending: 0, completed: 0 };
      const pendingTasks = [];

      tasksData
        .filter(task => task.type !== 'REMINDER_3_DAY') // Excluir recordatorios
        .forEach(task => {
            const status = getTaskStatus(task);
            if (status === 'completed') taskStats.completed++;
            else if (status === 'overdue') taskStats.overdue++;
            else {
                taskStats.pending++;
                pendingTasks.push(task); // Guardar para la lista de próximas tareas
            }
        });

      // 2. Ordenar tareas pendientes por fecha y obtener las próximas 5
      pendingTasks.sort((a, b) => a.dueDate._seconds - b.dueDate._seconds);

      setStats(taskStats);
      setUpcomingTasks(pendingTasks.slice(0, 5));
      setLotes(lotesData);
      setLoading(false);

    }).catch(err => {
      console.error("Error fetching dashboard data:", err);
      setError("No se pudieron cargar los datos del dashboard. Revisa la consola para más detalles.");
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div>Cargando panel de control...</div>;
  }

  if (error) {
    return <p>{error}</p>;
  }

  return (
    <div className="dashboard-container">
      <h2>Panel de Control</h2>
      
      <div className="summary-cards">
        <Link to="/tasks?filter=overdue" className="summary-card status-overdue">
          <h3>{stats.overdue}</h3>
          <p>Tareas Vencidas</p>
        </Link>
        <Link to="/tasks?filter=pending" className="summary-card status-pending">
          <h3>{stats.pending}</h3>
          <p>Tareas Pendientes</p>
        </Link>
        <Link to="/tasks?filter=completed" className="summary-card status-completed">
          <h3>{stats.completed}</h3>
          <p>Tareas Hechas</p>
        </Link>
      </div>

      <div className="dashboard-columns">
        <div className="column-upcoming-tasks">
          <h3>Próximas 5 Tareas Pendientes</h3>
          {upcomingTasks.length > 0 ? (
            <ul className="upcoming-tasks-list">
              {upcomingTasks.map(task => (
                <li key={task.id}>
                  <strong>{task.activityName}</strong> (Lote: {task.loteName})
                  <span>Vence: {new Date(task.dueDate._seconds * 1000).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No hay tareas pendientes.</p>
          )}
        </div>

        <div className="column-active-lotes">
          <h3>Lotes Activos</h3>
          {lotes.length > 0 ? (
            <ul className="active-lotes-list">
                {lotes.map(lote => (
                    <li key={lote.id}>
                        <strong>{lote.nombreLote}</strong>
                        <span>Creado: {new Date(lote.fechaCreacion._seconds * 1000).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</span>
                    </li>
                ))}
            </ul>
          ) : (
             <p>No hay lotes creados.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
