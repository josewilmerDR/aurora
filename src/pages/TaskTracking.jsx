import { useState, useEffect } from 'react';

function TaskTracking() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // Estado para el filtro: 'all', 'overdue', 'pending', 'completed'

  useEffect(() => {
    fetch('/api/tasks')
      .then(res => {
        if (!res.ok) {
          throw new Error('La respuesta de la red no fue correcta');
        }
        return res.json();
      })
      .then(data => {
        data.sort((a, b) => a.dueDate._seconds - b.dueDate._seconds);
        setTasks(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching tasks:", err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const getTaskDisplayStatus = (task) => {
    if (task.status === 'completed_by_user') {
      return { text: 'Hecha', className: 'status-completed', key: 'completed' };
    }

    const today = new Date();
    const dueDate = new Date(task.dueDate._seconds * 1000);
    const dueDateDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (dueDateDay < todayDay) {
      return { text: 'Vencida', className: 'status-overdue', key: 'overdue' };
    }

    return { text: 'Pendiente', className: 'status-pending', key: 'pending' };
  };

  if (loading) {
    return <div>Cargando tareas...</div>;
  }

  if (error) {
    return <div>Error al cargar las tareas: {error}. Asegúrate de que el servidor está funcionando.</div>;
  }

  const tasksWithStatus = tasks
    .filter(task => task.type !== 'REMINDER_3_DAY')
    .map(task => ({ ...task, displayStatus: getTaskDisplayStatus(task) }));
  
  const filteredTasks = tasksWithStatus.filter(task => {
      if (filter === 'all') return true;
      return task.displayStatus.key === filter;
  });

  return (
    <div>
      <h2>Seguimiento de Tareas</h2>

      <div className="filter-buttons">
        <button onClick={() => setFilter('all')} className={filter === 'all' ? 'active' : ''}>Todas</button>
        <button onClick={() => setFilter('overdue')} className={filter === 'overdue' ? 'active' : ''}>Vencidas</button>
        <button onClick={() => setFilter('pending')} className={filter === 'pending' ? 'active' : ''}>Pendientes</button>
        <button onClick={() => setFilter('completed')} className={filter === 'completed' ? 'active' : ''}>Hechas</button>
      </div>

      {filteredTasks.length === 0 && !loading && <p>No hay tareas que coincidan con el filtro seleccionado.</p>}
      <div className="task-list-view">
        {filteredTasks.map(task => (
            <div key={task.id} className={`task-card-view ${task.displayStatus.className}`}>
              <h4>{task.activityName}</h4>
              <p><strong>Lote:</strong> {task.loteName}</p>
              <p><strong>Responsable:</strong> {task.responsableName}</p>
              <p><strong>Fecha Límite:</strong> {new Date(task.dueDate._seconds * 1000).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</p>
              <p><strong>Estado:</strong> <span className="status-badge">{task.displayStatus.text}</span></p>
            </div>
        ))}
      </div>
    </div>
  );
}

export default TaskTracking;
