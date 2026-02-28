import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './TaskTracking.css'; // Importamos los nuevos estilos

// Helper para parsear los query params de la URL
function useQuery() {
  return new URLSearchParams(useLocation().search);
}

function TaskTracking() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // El filtro ahora se controla por la URL para enlazar desde el Dashboard
  const query = useQuery();
  const [filter, setFilter] = useState(query.get('filter') || 'all');

  // --- LÓGICA DE DATOS (sin cambios) ---
  useEffect(() => {
    fetch('/api/tasks')
      .then(res => res.ok ? res.json() : Promise.reject('Error de red'))
      .then(data => {
        data.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        setTasks(data);
      })
      .catch(err => setError(err.toString()))
      .finally(() => setLoading(false));
  }, []);

  const getTaskDisplayStatus = (task) => {
    if (task.status === 'completed_by_user') {
      return { text: 'Hecha', className: 'status-completed', key: 'completed' };
    }
    const today = new Date();
    const dueDate = new Date(task.dueDate);
    const dueDateDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (dueDateDay < todayDay) {
      return { text: 'Vencida', className: 'status-overdue', key: 'overdue' };
    }
    return { text: 'Pendiente', className: 'status-pending', key: 'pending' };
  };
  // --- FIN DE LA LÓGICA ---

  const tasksWithStatus = tasks
    .filter(task => task.type !== 'REMINDER_3_DAY')
    .map(task => ({ ...task, displayStatus: getTaskDisplayStatus(task) }));
  
  const filteredTasks = tasksWithStatus.filter(task => filter === 'all' || task.displayStatus.key === filter);

  const renderTaskCard = (task) => (
    <div key={task.id} className={`task-card ${task.displayStatus.className}`}>
        <div className="task-card-header">
            <h4>{task.activityName}</h4>
        </div>
        <div className="task-card-body">
            <span className="task-detail"><strong>Lote:</strong> {task.loteName}</span>
            <span className="task-detail"><strong>Responsable:</strong> {task.responsableName}</span>
        </div>
        <div className="task-card-footer">
            <span>{new Date(task.dueDate).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</span>
            <span className="task-status-badge">{task.displayStatus.text}</span>
        </div>
    </div>
  );

  const groupedTasks = {
      overdue: tasksWithStatus.filter(t => t.displayStatus.key === 'overdue'),
      pending: tasksWithStatus.filter(t => t.displayStatus.key === 'pending'),
      completed: tasksWithStatus.filter(t => t.displayStatus.key === 'completed'),
  };

  if (loading) return <div className="empty-state">Cargando tareas...</div>;
  if (error) return <div className="empty-state">Error: {error}</div>;

  return (
    <div>
      <div className="task-tracking-header">
        <h2>Seguimiento de Tareas</h2>
        <div className="filter-pills">
          <button onClick={() => setFilter('all')} className={`pill-btn ${filter === 'all' ? 'active' : ''}`}>Todas</button>
          <button onClick={() => setFilter('overdue')} className={`pill-btn ${filter === 'overdue' ? 'active' : ''}`}>Vencidas</button>
          <button onClick={() => setFilter('pending')} className={`pill-btn ${filter === 'pending' ? 'active' : ''}`}>Pendientes</button>
          <button onClick={() => setFilter('completed')} className={`pill-btn ${filter === 'completed' ? 'active' : ''}`}>Hechas</button>
        </div>
      </div>

      {filteredTasks.length === 0 && <p className="empty-state">No hay tareas en esta categoría.</p>}

      {filter === 'all' ? (
          <div>
              {groupedTasks.overdue.length > 0 && (
                  <div className="task-group">
                      <h3 className="task-group-title">Vencidas</h3>
                      <div className="tasks-grid">{groupedTasks.overdue.map(renderTaskCard)}</div>
                  </div>
              )}
              {groupedTasks.pending.length > 0 && (
                  <div className="task-group">
                      <h3 className="task-group-title">Pendientes</h3>
                      <div className="tasks-grid">{groupedTasks.pending.map(renderTaskCard)}</div>
                  </div>
              )}
              {groupedTasks.completed.length > 0 && (
                  <div className="task-group">
                      <h3 className="task-group-title">Hechas</h3>
                      <div className="tasks-grid">{groupedTasks.completed.map(renderTaskCard)}</div>
                  </div>
              )}
          </div>
      ) : (
          <div className="tasks-grid">
              {filteredTasks.map(renderTaskCard)}
          </div>
      )}
    </div>
  );
}

export default TaskTracking;
