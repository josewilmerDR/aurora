import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/task-action.css';

// Today's date in the user's local timezone (YYYY-MM-DD). Using toISOString()
// would give UTC, which shifts to tomorrow for UTC-negative zones after ~18:00
// local and would block the user from scheduling for the current day.
const localToday = () => {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60 * 1000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().split('T')[0];
};

const isValidYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && Number.isFinite(new Date(s).getTime());

const TaskAction = () => {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const [action, setAction] = useState(null); // null | 'reschedule' | 'reassign'
  const [saving, setSaving] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [users, setUsers] = useState([]);
  const [newUserId, setNewUserId] = useState('');

  useEffect(() => {
    let cancelled = false;

    const fetchTask = async () => {
      try {
        setLoading(true);
        const response = await apiFetch(`/api/tasks/${taskId}`);
        if (!response.ok) throw new Error('La tarea no fue encontrada o no tienes acceso a ella.');
        const data = await response.json();
        if (!cancelled) setTask(data);
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const fetchUsers = async () => {
      try {
        const res = await apiFetch('/api/users');
        const data = await res.json();
        if (!cancelled) setUsers(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error fetching users for reassign dropdown:', err);
      }
    };

    fetchTask();
    fetchUsers();
    return () => { cancelled = true; };
  }, [taskId, apiFetch]);

  const handleCompleteTask = async () => {
    setActionError(null);
    setSaving(true);
    try {
      const response = await apiFetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'completed_by_user' }),
      });
      if (!response.ok) throw new Error('No se pudo actualizar la tarea.');
      setTask(prev => ({ ...prev, status: 'completed_by_user' }));
      setSuccessMessage(`¡Tarea "${task.activityName}" marcada como hecha!`);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReschedule = async () => {
    if (!isValidYmd(newDate) || newDate < localToday()) {
      setActionError('Selecciona una fecha válida igual o posterior a hoy.');
      return;
    }
    setActionError(null);
    setSaving(true);
    try {
      const res = await apiFetch(`/api/tasks/${taskId}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({ newDate }),
      });
      if (!res.ok) throw new Error('No se pudo reprogramar la tarea.');
      setTask(prev => prev ? ({ ...prev, dueDate: new Date(newDate).toISOString() }) : prev);
      setAction(null);
      setSuccessMessage(`Tarea reprogramada para el ${new Date(newDate).toLocaleDateString('es-ES', { timeZone: 'UTC' })}.`);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReassign = async () => {
    const newUser = users.find(u => u.id === newUserId);
    if (!newUser) {
      setActionError('Selecciona un usuario válido.');
      return;
    }
    setActionError(null);
    setSaving(true);
    try {
      const res = await apiFetch(`/api/tasks/${taskId}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ newUserId }),
      });
      if (!res.ok) throw new Error('No se pudo reasignar la tarea.');
      setTask(prev => prev ? ({
        ...prev,
        activity: { ...prev.activity, responsableId: newUserId },
        responsableName: newUser.nombre,
        responsableTel: newUser.telefono || '—',
      }) : prev);
      setAction(null);
      setSuccessMessage(`Tarea reasignada a ${newUser.nombre}. Se envió notificación por WhatsApp.`);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const today = localToday();

  if (loading) return <div className="task-action-state">Cargando detalles de la tarea...</div>;
  if (loadError || !task) return <div className="task-action-state error">Error: {loadError || 'Tarea no disponible.'}</div>;

  const isCompleted = task.status === 'completed_by_user';
  const isSolicitudCompra = task.type === 'SOLICITUD_COMPRA';
  const isAplicacion = task.activity?.type === 'aplicacion'
    || (task.activity?.productos?.length > 0 && !isSolicitudCompra);
  const loteHectareas = task.loteHectareas || 1;

  return (
    <div className="task-action-wrapper">
      <div className="task-action-card">
        <button className="btn-back-nav" onClick={() => navigate('/tasks')}>
          ← Volver a Seguimiento de Tareas
        </button>
        <h1>Gestionar Tarea</h1>

        <div className="task-info-grid">
          <span className="task-info-label">Tarea</span>
          <span className="task-info-value">{task.activityName}</span>

          {!isSolicitudCompra && (
            <>
              <span className="task-info-label">Lote</span>
              <span className="task-info-value">{task.loteName}</span>
            </>
          )}

          <span className="task-info-label">Responsable</span>
          <span className="task-info-value">{task.responsableName}</span>

          <span className="task-info-label">Vencimiento</span>
          <span className="task-info-value">
            {new Date(task.dueDate).toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>

          <span className="task-info-label">Estado</span>
          <span className="task-info-value">
            <span className={`task-status-badge-action ${isCompleted ? 'completed' : ''}`}>
              {isCompleted ? 'Completada' : 'Pendiente'}
            </span>
          </span>
        </div>

        {successMessage && (
          <div className="success-message">
            {successMessage}
            <br />
            <button className="btn-back" onClick={() => navigate('/')}>
              Volver al Panel de Control
            </button>
          </div>
        )}

        {isAplicacion && task.activity?.productos?.length > 0 && (() => {
          // Tarea ad-hoc: cantidad absoluta por producto (sin cantidadPorHa)
          const isAdHoc = task.activity.productos.every(p => p.cantidad !== undefined);
          return (
            <div className="recipe-panel">
              <h2 className="recipe-title">Instrucciones de Mezcla</h2>
              {!isAdHoc && (
                <p className="recipe-subtitle">
                  Área del lote: <strong>{loteHectareas} ha</strong>
                </p>
              )}
              <table className="recipe-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    {!isAdHoc && <th>Dosis/Ha</th>}
                    <th>Cantidad total</th>
                    <th>Unidad</th>
                  </tr>
                </thead>
                <tbody>
                  {task.activity.productos.map(p => {
                    const total = isAdHoc
                      ? p.cantidad
                      : (p.cantidadPorHa * loteHectareas).toFixed(2);
                    return (
                      <tr key={p.productoId}>
                        <td>{p.nombreComercial}</td>
                        {!isAdHoc && <td>{p.cantidadPorHa}</td>}
                        <td><strong>{total}</strong></td>
                        <td>{p.unidad}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="recipe-warnings">
                {task.activity.productos.some(p => p.periodoReingreso > 0) && (
                  <span className="recipe-warning">
                    ⚠ Reingreso: {Math.max(...task.activity.productos.map(p => p.periodoReingreso || 0))} h
                  </span>
                )}
                {task.activity.productos.some(p => p.periodoACosecha > 0) && (
                  <span className="recipe-warning">
                    ⚠ Carencia: {Math.max(...task.activity.productos.map(p => p.periodoACosecha || 0))} días
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {isSolicitudCompra && task.activity?.productos?.length > 0 && (
          <div className="recipe-panel">
            <h2 className="recipe-title">🛒 Productos Solicitados</h2>
            {task.notas && (
              <p className="recipe-subtitle">
                Nota del bodeguero: <em>{task.notas}</em>
              </p>
            )}
            <table className="recipe-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Stock actual</th>
                  <th>Cantidad solicitada</th>
                </tr>
              </thead>
              <tbody>
                {task.activity.productos.map(p => {
                  const isLow = p.stockActual <= p.stockMinimo;
                  return (
                    <tr key={p.productoId}>
                      <td>{p.nombreComercial}</td>
                      <td style={{ color: isLow ? '#ff6b6b' : 'inherit' }}>
                        {isLow ? '⚠ ' : ''}{p.stockActual} {p.unidad}
                      </td>
                      <td><strong>{p.cantidad} {p.unidad}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!successMessage && (
          <div className="task-actions-section">
            <h2>Acciones</h2>

            {actionError && (
              <div className="action-error" role="alert">{actionError}</div>
            )}

            {!isCompleted && !isAplicacion && (
              <button className="btn-complete" onClick={handleCompleteTask} disabled={saving}>
                {saving ? 'Guardando…' : '✓ Marcar como Hecha'}
              </button>
            )}

            <div className="action-buttons-row">
              {!isCompleted && (
                <>
                  {!isAplicacion && (
                    <button
                      className={`btn-action reschedule ${action === 'reschedule' ? 'active' : ''}`}
                      onClick={() => setAction(action === 'reschedule' ? null : 'reschedule')}
                    >
                      📅 Reprogramar
                    </button>
                  )}
                  <button
                    className={`btn-action reassign ${action === 'reassign' ? 'active' : ''}`}
                    onClick={() => setAction(action === 'reassign' ? null : 'reassign')}
                  >
                    👤 Reasignar
                  </button>
                </>
              )}
              {isSolicitudCompra && (
                <button
                  className="btn-action generate-po"
                  onClick={() => navigate('/ordenes-compra', { state: { autoLoadTaskId: taskId } })}
                >
                  🛒 Crear Orden de Compra
                </button>
              )}
              {isAplicacion && (
                <Link
                  to={`/aplicaciones/cedulas?open=${taskId}`}
                  className="btn-action cedula"
                >
                  📋 Ver Cédula de Aplicación
                </Link>
              )}
            </div>

            {!isCompleted && !isAplicacion && action === 'reschedule' && (
              <div className="action-panel">
                <label>Nueva fecha</label>
                <input
                  type="date"
                  min={today}
                  value={newDate}
                  onChange={e => setNewDate(e.target.value)}
                />
                <button
                  className="btn-confirm reschedule"
                  onClick={handleReschedule}
                  disabled={!newDate || saving}
                >
                  {saving ? 'Guardando…' : 'Confirmar nueva fecha'}
                </button>
              </div>
            )}

            {!isCompleted && action === 'reassign' && (
              <div className="action-panel">
                <label>Nuevo responsable</label>
                <select
                  value={newUserId}
                  onChange={e => setNewUserId(e.target.value)}
                >
                  <option value="">-- Seleccionar usuario --</option>
                  {users.filter(u => u.id !== task.activity?.responsableId).map(u => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}{u.telefono ? ` · ${u.telefono}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-confirm reassign"
                  onClick={handleReassign}
                  disabled={!newUserId || saving}
                >
                  {saving ? 'Enviando…' : 'Confirmar y enviar WhatsApp'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskAction;
