import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import {
  FiArrowLeft, FiInfo, FiDroplet, FiSettings, FiCalendar, FiUser,
  FiShoppingCart, FiFileText, FiCheck, FiAlertCircle, FiAlertTriangle, FiHome,
} from 'react-icons/fi';
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
  const location = useLocation();
  const apiFetch = useApiFetch();
  // Capability token from the WhatsApp deep-link; forwarded to the
  // backend so the public GET can verify the signature.
  const linkToken = new URLSearchParams(location.search).get('t');
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
        const url = linkToken
          ? `/api/tasks/${taskId}?t=${encodeURIComponent(linkToken)}`
          : `/api/tasks/${taskId}`;
        const response = await apiFetch(url);
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
  }, [taskId, apiFetch, linkToken]);

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

  if (loading) {
    return (
      <div className="task-action-page">
        <div className="aur-page-loading" />
      </div>
    );
  }
  if (loadError || !task) {
    return (
      <div className="task-action-page">
        <div className="task-action-state task-action-state--error">
          <FiAlertCircle size={18} /> {loadError || 'Tarea no disponible.'}
        </div>
      </div>
    );
  }

  const isCompleted = task.status === 'completed_by_user';
  const isSolicitudCompra = task.type === 'SOLICITUD_COMPRA';
  const isAplicacion = task.activity?.type === 'aplicacion'
    || (task.activity?.productos?.length > 0 && !isSolicitudCompra);
  const loteHectareas = task.loteHectareas || 1;

  return (
    <div className="task-action-page">
      <div className="aur-sheet aur-sheet--card task-action-sheet">
        <button
          type="button"
          className="aur-btn-text task-action-back"
          onClick={() => navigate('/tasks')}
        >
          <FiArrowLeft size={14} /> Volver a Seguimiento de Tareas
        </button>

        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">Gestionar tarea</h1>
            <p className="aur-sheet-subtitle">{task.activityName}</p>
          </div>
        </header>

        {/* ── Información ─────────────────────────────────────────────── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiInfo size={14} /></span>
            <h3 className="aur-section-title">Información</h3>
          </div>
          <div className="aur-list">
            <div className="aur-row task-action-info-row">
              <div className="aur-row-label">Tarea</div>
              <div className="task-action-info-value">{task.activityName}</div>
            </div>
            {!isSolicitudCompra && (
              <div className="aur-row task-action-info-row">
                <div className="aur-row-label">Lote</div>
                <div className="task-action-info-value">{task.loteName}</div>
              </div>
            )}
            <div className="aur-row task-action-info-row">
              <div className="aur-row-label">Responsable</div>
              <div className="task-action-info-value">{task.responsableName}</div>
            </div>
            <div className="aur-row task-action-info-row">
              <div className="aur-row-label">Vencimiento</div>
              <div className="task-action-info-value">
                {new Date(task.dueDate).toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
            <div className="aur-row task-action-info-row">
              <div className="aur-row-label">Estado</div>
              <div className="task-action-info-value">
                <span className={`aur-badge ${isCompleted ? 'aur-badge--green' : 'aur-badge--yellow'}`}>
                  {isCompleted ? 'Completada' : 'Pendiente'}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Success message (reemplaza acciones cuando hay éxito) ───── */}
        {successMessage && (
          <div className="task-action-success" role="status">
            <span className="task-action-success-icon"><FiCheck size={18} /></span>
            <span>{successMessage}</span>
            <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={() => navigate('/')}>
              <FiHome size={14} /> Volver al panel
            </button>
          </div>
        )}

        {/* ── Recipe panel: aplicación con productos ──────────────────── */}
        {isAplicacion && task.activity?.productos?.length > 0 && (() => {
          // Tarea ad-hoc: cantidad absoluta por producto (sin cantidadPorHa)
          const isAdHoc = task.activity.productos.every(p => p.cantidad !== undefined);
          return (
            <section className="aur-section">
              <div className="aur-section-header">
                <span className="aur-section-num"><FiDroplet size={14} /></span>
                <h3 className="aur-section-title">Instrucciones de mezcla</h3>
                {!isAdHoc && (
                  <span className="aur-section-count">{loteHectareas} ha</span>
                )}
              </div>
              <div className="aur-table-wrap">
                <table className="aur-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      {!isAdHoc && <th className="aur-td-num">Dosis/Ha</th>}
                      <th className="aur-td-num">Cantidad total</th>
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
                          {!isAdHoc && <td className="aur-td-num">{p.cantidadPorHa}</td>}
                          <td className="aur-td-num task-action-recipe-total">{total}</td>
                          <td>{p.unidad}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(task.activity.productos.some(p => p.periodoReingreso > 0)
                || task.activity.productos.some(p => p.periodoACosecha > 0)) && (
                <div className="task-action-warnings">
                  {task.activity.productos.some(p => p.periodoReingreso > 0) && (
                    <span className="task-action-warning">
                      <FiAlertTriangle size={13} /> Reingreso: {Math.max(...task.activity.productos.map(p => p.periodoReingreso || 0))} h
                    </span>
                  )}
                  {task.activity.productos.some(p => p.periodoACosecha > 0) && (
                    <span className="task-action-warning">
                      <FiAlertTriangle size={13} /> Carencia: {Math.max(...task.activity.productos.map(p => p.periodoACosecha || 0))} días
                    </span>
                  )}
                </div>
              )}
            </section>
          );
        })()}

        {/* ── Solicitud de compra: productos solicitados ──────────────── */}
        {isSolicitudCompra && task.activity?.productos?.length > 0 && (
          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num"><FiShoppingCart size={14} /></span>
              <h3 className="aur-section-title">Productos solicitados</h3>
            </div>
            {task.notas && (
              <p className="task-action-notas">
                Nota del bodeguero: <em>{task.notas}</em>
              </p>
            )}
            <div className="aur-table-wrap">
              <table className="aur-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="aur-td-num">Stock actual</th>
                    <th className="aur-td-num">Cantidad solicitada</th>
                  </tr>
                </thead>
                <tbody>
                  {task.activity.productos.map(p => {
                    const isLow = p.stockActual <= p.stockMinimo;
                    return (
                      <tr key={p.productoId}>
                        <td>{p.nombreComercial}</td>
                        <td className={`aur-td-num${isLow ? ' task-action-stock-low' : ''}`}>
                          {isLow && <FiAlertTriangle size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />}
                          {p.stockActual} {p.unidad}
                        </td>
                        <td className="aur-td-num task-action-recipe-total">{p.cantidad} {p.unidad}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Acciones ────────────────────────────────────────────────── */}
        {!successMessage && (
          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num"><FiSettings size={14} /></span>
              <h3 className="aur-section-title">Acciones</h3>
            </div>

            {actionError && (
              <div className="task-action-error" role="alert">
                <FiAlertCircle size={14} /> {actionError}
              </div>
            )}

            {!isCompleted && !isAplicacion && (
              <button
                type="button"
                className="aur-btn-pill task-action-complete"
                onClick={handleCompleteTask}
                disabled={saving}
              >
                <FiCheck size={14} /> {saving ? 'Guardando…' : 'Marcar como hecha'}
              </button>
            )}

            <div className="task-action-buttons-row">
              {!isCompleted && (
                <>
                  {!isAplicacion && (
                    <button
                      type="button"
                      className={`aur-btn-pill task-action-btn task-action-btn--info${action === 'reschedule' ? ' is-active' : ''}`}
                      onClick={() => setAction(action === 'reschedule' ? null : 'reschedule')}
                    >
                      <FiCalendar size={14} /> Reprogramar
                    </button>
                  )}
                  <button
                    type="button"
                    className={`aur-btn-pill task-action-btn task-action-btn--magenta${action === 'reassign' ? ' is-active' : ''}`}
                    onClick={() => setAction(action === 'reassign' ? null : 'reassign')}
                  >
                    <FiUser size={14} /> Reasignar
                  </button>
                </>
              )}
              {isSolicitudCompra && (
                <button
                  type="button"
                  className="aur-btn-pill task-action-btn task-action-btn--accent"
                  onClick={() => navigate('/ordenes-compra', { state: { autoLoadTaskId: taskId } })}
                >
                  <FiShoppingCart size={14} /> Crear orden de compra
                </button>
              )}
              {isAplicacion && (
                <Link
                  to={`/aplicaciones/cedulas?open=${taskId}`}
                  className="aur-btn-pill task-action-btn task-action-btn--magenta"
                >
                  <FiFileText size={14} /> Ver cédula de aplicación
                </Link>
              )}
            </div>

            {!isCompleted && !isAplicacion && action === 'reschedule' && (
              <div className="task-action-panel">
                <div className="aur-field">
                  <label className="aur-field-label" htmlFor="ta-reschedule-date">Nueva fecha</label>
                  <input
                    id="ta-reschedule-date"
                    type="date"
                    className="aur-input"
                    min={today}
                    value={newDate}
                    onChange={e => setNewDate(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="aur-btn-pill task-action-confirm"
                  onClick={handleReschedule}
                  disabled={!newDate || saving}
                >
                  {saving ? 'Guardando…' : 'Confirmar nueva fecha'}
                </button>
              </div>
            )}

            {!isCompleted && action === 'reassign' && (
              <div className="task-action-panel">
                <div className="aur-field">
                  <label className="aur-field-label" htmlFor="ta-reassign-user">Nuevo responsable</label>
                  <select
                    id="ta-reassign-user"
                    className="aur-select"
                    value={newUserId}
                    onChange={e => setNewUserId(e.target.value)}
                  >
                    <option value="">— Seleccionar usuario —</option>
                    {users.filter(u => u.id !== task.activity?.responsableId).map(u => (
                      <option key={u.id} value={u.id}>
                        {u.nombre}{u.telefono ? ` · ${u.telefono}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="aur-btn-pill task-action-confirm"
                  onClick={handleReassign}
                  disabled={!newUserId || saving}
                >
                  {saving ? 'Enviando…' : 'Confirmar y enviar WhatsApp'}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

export default TaskAction;
