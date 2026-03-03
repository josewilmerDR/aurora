import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './TaskAction.css';

const TaskAction = () => {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const [action, setAction] = useState(null); // null | 'reschedule' | 'reassign'
  const [saving, setSaving] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [users, setUsers] = useState([]);
  const [newUserId, setNewUserId] = useState('');

  useEffect(() => {
    const fetchTask = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/tasks/${taskId}`);
        if (!response.ok) throw new Error('La tarea no fue encontrada o no tienes acceso a ella.');
        const data = await response.json();
        setTask(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    const fetchUsers = async () => {
      try {
        const res = await fetch('/api/users');
        const data = await res.json();
        setUsers(data);
      } catch (_) {}
    };

    fetchTask();
    fetchUsers();
  }, [taskId]);

  const handleCompleteTask = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed_by_user' }),
      });
      if (!response.ok) throw new Error('No se pudo actualizar la tarea.');
      setTask(prev => ({ ...prev, status: 'completed_by_user' }));
      setSuccessMessage(`¡Tarea "${task.activityName}" marcada como hecha!`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReschedule = async () => {
    if (!newDate) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newDate }),
      });
      if (!res.ok) throw new Error('No se pudo reprogramar la tarea.');
      setAction(null);
      setSuccessMessage(`Tarea reprogramada para el ${new Date(newDate).toLocaleDateString('es-ES', { timeZone: 'UTC' })}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReassign = async () => {
    if (!newUserId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newUserId }),
      });
      if (!res.ok) throw new Error('No se pudo reasignar la tarea.');
      const newUser = users.find(u => u.id === newUserId);
      setAction(null);
      setSuccessMessage(`Tarea reasignada a ${newUser?.nombre || 'nuevo responsable'}. Se envió notificación por WhatsApp.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const today = new Date().toISOString().split('T')[0];

  if (loading) return <div className="task-action-state">Cargando detalles de la tarea...</div>;
  if (error) return <div className="task-action-state error">Error: {error}</div>;

  const isCompleted = task.status === 'completed_by_user';
  const isAplicacion = task.activity?.type === 'aplicacion';
  const isSolicitudCompra = task.type === 'SOLICITUD_COMPRA';
  const loteHectareas = task.loteHectareas || 1;

  return (
    <div className="task-action-wrapper">
      <div className="task-action-card">
        <button className="btn-back-nav" onClick={() => navigate('/tasks')}>
          ← Volver a Seguimiento de Tareas
        </button>
        <h1>Gestionar Tarea</h1>

        <div className="task-info-grid">
          <span className="task-info-label">Actividad</span>
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
            <div className="recipe-panel-header">
              <h2 className="recipe-title">🛒 Productos Solicitados</h2>
              <button
                className="btn-generate-po"
                onClick={() => navigate(`/orden-compra/${taskId}`)}
              >
                📄 Generar Orden de Compra
              </button>
            </div>
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

            {!isCompleted && (
              <button className="btn-complete" onClick={handleCompleteTask} disabled={saving}>
                {saving ? 'Guardando…' : '✓ Marcar como Hecha'}
              </button>
            )}

            <div className="action-buttons-row">
              <button
                className={`btn-action reschedule ${action === 'reschedule' ? 'active' : ''}`}
                onClick={() => setAction(action === 'reschedule' ? null : 'reschedule')}
              >
                📅 Reprogramar
              </button>
              <button
                className={`btn-action reassign ${action === 'reassign' ? 'active' : ''}`}
                onClick={() => setAction(action === 'reassign' ? null : 'reassign')}
              >
                👤 Reasignar
              </button>
            </div>

            {action === 'reschedule' && (
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

            {action === 'reassign' && (
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
