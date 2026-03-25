import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { FiPlus, FiX, FiFileText, FiMoreVertical } from 'react-icons/fi';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import './TaskTracking.css';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser } from '../contexts/UserContext';

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

function TaskTracking() {
  const apiFetch = useApiFetch();
  const { activeFincaId, firebaseUser } = useUser();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const urlQuery = useQuery();
  const [filter, setFilter] = useState(urlQuery.get('filter') || 'all');

  // --- Estado del formulario de nueva tarea ---
  const [showNewTask, setShowNewTask] = useState(false);
  const [formLotes, setFormLotes] = useState([]);
  const [formUsers, setFormUsers] = useState([]);
  const [formProductos, setFormProductos] = useState([]);
  const [formData, setFormData] = useState({ nombre: '', loteId: '', responsableId: '', fecha: '', productos: [] });
  const [prodSearch, setProdSearch] = useState('');
  const [showProdDropdown, setShowProdDropdown] = useState(false);
  const [formSaving, setFormSaving] = useState(false);

  // --- Estado de plantillas ---
  const [plantillas, setPlantillas] = useState([]);
  const [savingPlantilla, setSavingPlantilla] = useState(false);
  const [plantillaSaved, setPlantillaSaved] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const debounceRef = useRef(null);

  // --- Tareas descartadas del panel (solo frontend, persiste en localStorage) ---
  const dismissedKey = `aurora_dismissed_tasks_${firebaseUser?.uid || 'guest'}`;
  const [dismissedIds, setDismissedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`aurora_dismissed_tasks_${firebaseUser?.uid || 'guest'}`) || '[]')); }
    catch { return new Set(); }
  });

  const archivedKey = `aurora_archived_tasks_${firebaseUser?.uid || 'guest'}`;
  const [archivedIds, setArchivedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`aurora_archived_tasks_${firebaseUser?.uid || 'guest'}`) || '[]')); }
    catch { return new Set(); }
  });

  const [openKebabId, setOpenKebabId] = useState(null);

  const fetchTasks = useCallback(() => {
    apiFetch('/api/tasks')
      .then(res => res.ok ? res.json() : Promise.reject('Error de red'))
      .then(data => {
        data.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        setTasks(data);
      })
      .catch(err => setError(err.toString()))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  // Carga inicial
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Listener en tiempo real: onSnapshot solo dispara cuando hay cambios reales en Firestore.
  // Sin actividad (fines de semana, noches) el WebSocket está abierto pero no genera lecturas.
  useEffect(() => {
    if (!activeFincaId) return;
    const isFirst = { current: true };
    const q = query(
      collection(db, 'scheduled_tasks'),
      where('fincaId', '==', activeFincaId)
    );
    const unsubscribe = onSnapshot(q, () => {
      // Ignorar el disparo inicial (ya lo carga fetchTasks arriba)
      if (isFirst.current) { isFirst.current = false; return; }
      // Debounce 400ms para agrupar escrituras en lote
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(fetchTasks, 400);
    });
    return () => { unsubscribe(); clearTimeout(debounceRef.current); };
  }, [activeFincaId, fetchTasks]);

  const dismissTask = (taskId, e) => {
    e.stopPropagation();
    const next = new Set(dismissedIds);
    next.add(taskId);
    setDismissedIds(next);
    localStorage.setItem(dismissedKey, JSON.stringify([...next]));
    setOpenKebabId(null);
  };

  const archiveTask = (taskId, e) => {
    e.stopPropagation();
    const next = new Set(archivedIds);
    next.add(taskId);
    setArchivedIds(next);
    localStorage.setItem(archivedKey, JSON.stringify([...next]));
    setOpenKebabId(null);
  };

  useEffect(() => {
    if (!openKebabId) return;
    const handler = (e) => { if (!e.target.closest('.task-kebab-menu')) setOpenKebabId(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openKebabId]);

  // Cargar lotes, usuarios, productos y plantillas cuando se abre el formulario
  useEffect(() => {
    if (!showNewTask) return;
    Promise.all([
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/productos').then(r => r.json()),
      apiFetch('/api/task-templates').then(r => r.json()),
    ]).then(([l, u, p, t]) => {
      setFormLotes(l);
      setFormUsers(u);
      setFormProductos(p);
      setPlantillas(t);
    }).catch(console.error);
  }, [showNewTask]);

  // --- Handlers del formulario ---
  const addProductLine = (productoId) => {
    if (!productoId) return;
    const p = formProductos.find(x => x.id === productoId);
    if (!p || formData.productos.find(x => x.productoId === productoId)) return;
    setFormData(prev => ({
      ...prev,
      productos: [...prev.productos, {
        productoId: p.id,
        nombreComercial: p.nombreComercial,
        cantidad: '',
        unidad: p.unidad,
        periodoReingreso: p.periodoReingreso || 0,
        periodoACosecha: p.periodoACosecha || 0,
      }],
    }));
    setProdSearch('');
    setShowProdDropdown(false);
  };

  const removeProductLine = (productoId) => {
    setFormData(prev => ({ ...prev, productos: prev.productos.filter(p => p.productoId !== productoId) }));
  };

  const updateProductCantidad = (productoId, value) => {
    setFormData(prev => ({
      ...prev,
      productos: prev.productos.map(p => p.productoId === productoId ? { ...p, cantidad: value } : p),
    }));
  };

  const resetForm = () => {
    setShowNewTask(false);
    setFormData({ nombre: '', loteId: '', responsableId: '', fecha: '', productos: [] });
    setProdSearch('');
    setShowProdDropdown(false);
    setPlantillaSaved(false);
  };

  // --- Handlers de plantillas ---
  const aplicarPlantilla = (plantilla) => {
    setFormData(prev => ({
      ...prev,
      nombre: plantilla.nombre,
      responsableId: plantilla.responsableId || prev.responsableId,
      productos: plantilla.productos.filter(
        p => formProductos.find(fp => fp.id === p.productoId)
      ),
    }));
  };

  const guardarComoPlantilla = async () => {
    if (!formData.nombre) return;
    setSavingPlantilla(true);
    try {
      const res = await apiFetch('/api/task-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: formData.nombre,
          responsableId: formData.responsableId,
          productos: formData.productos,
        }),
      });
      if (!res.ok) throw new Error();
      const nuevaPlantilla = await res.json();
      setPlantillas(prev => [...prev, nuevaPlantilla]);
      setPlantillaSaved(true);
      setTimeout(() => setPlantillaSaved(false), 2500);
    } catch {
      showToast('Error al guardar la plantilla.', 'error');
    } finally {
      setSavingPlantilla(false);
    }
  };

  const eliminarPlantilla = async (id) => {
    try {
      await apiFetch(`/api/task-templates/${id}`, { method: 'DELETE' });
      setPlantillas(prev => prev.filter(p => p.id !== id));
    } catch {
      showToast('Error al eliminar la plantilla.', 'error');
    }
  };

  const canSubmit = formData.nombre && formData.loteId && formData.responsableId && formData.fecha
    && formData.productos.every(p => parseFloat(p.cantidad) > 0);

  const handleCreateTask = async () => {
    if (!canSubmit) return;
    setFormSaving(true);
    try {
      const res = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error();
      const newTask = await res.json();
      setTasks(prev => [...prev, newTask].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)));
      resetForm();
      showToast('Actividad creada correctamente');
    } catch {
      showToast('Error al crear la actividad. Intenta de nuevo.', 'error');
    } finally {
      setFormSaving(false);
    }
  };

  // --- Lógica de visualización de tareas ---
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

  const tasksWithStatus = tasks
    .filter(task => task.type !== 'REMINDER_3_DAY')
    .map(task => ({ ...task, displayStatus: getTaskDisplayStatus(task) }));

  const visibleTasks = tasksWithStatus.filter(t => !dismissedIds.has(t.id));

  const filteredTasks = visibleTasks.filter(task => {
    if (archivedIds.has(task.id)) return false;
    if (filter === 'all') return true;
    if (filter === 'unassigned') return !task.activity?.responsableId;
    return task.displayStatus.key === filter;
  });

  const renderTaskCard = (task) => (
    <div
      key={task.id}
      className={`task-card ${task.displayStatus.className}`}
      onClick={() => task.type === 'PLANILLA_PAGO' ? navigate('/hr/planilla/fijo') : navigate(`/task/${task.id}`)}
      style={{ cursor: 'pointer' }}
    >
      <div className="task-card-header">
        <h4>{task.activityName}</h4>
        <div className="task-card-header-right">
          {task.activity?.type === 'aplicacion' && (
            <span className="task-aplicacion-tag">⚗ Aplicación</span>
          )}
          {task.type === 'SOLICITUD_COMPRA' && (
            <span className="task-aplicacion-tag" style={{ background: 'var(--aurora-magenta)', color: '#fff' }}>🛒 Compra</span>
          )}
          {task.type === 'PLANILLA_PAGO' && (
            <span className="task-aplicacion-tag" style={{ background: 'rgba(51,255,153,0.15)', color: 'var(--aurora-green)', border: '1px solid var(--aurora-green)' }}>💰 Planilla</span>
          )}
          <div className="task-kebab-menu">
            <button
              className="task-kebab-btn"
              onClick={e => { e.stopPropagation(); setOpenKebabId(openKebabId === task.id ? null : task.id); }}
              title="Más opciones"
            >
              <FiMoreVertical size={15} />
            </button>
            {openKebabId === task.id && (
              <div className="task-kebab-dropdown">
                {!archivedIds.has(task.id) && (
                  <button onClick={e => archiveTask(task.id, e)}>Archivar</button>
                )}
                <button className="task-kebab-dropdown__delete" onClick={e => dismissTask(task.id, e)}>Eliminar del panel</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="task-card-body">
        {task.type !== 'PLANILLA_PAGO' && (
          <span className="task-detail"><strong>Lote:</strong> {task.loteName}</span>
        )}
        <span className="task-detail"><strong>Responsable:</strong> {task.activity?.responsableId ? task.responsableName : <em style={{ color: 'var(--aurora-magenta)', fontStyle: 'normal' }}>Sin asignar</em>}</span>
      </div>
      <div className="task-card-footer">
        <span>{new Date(task.dueDate).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</span>
        <span className="task-status-badge">{task.displayStatus.text}</span>
        {archivedIds.has(task.id) && (
          <span className="task-archived-badge">Archivada</span>
        )}
        {(task.activity?.type === 'aplicacion' || (task.activity?.productos?.length > 0 && task.type !== 'SOLICITUD_COMPRA')) && (
          <Link
            to={`/aplicaciones/cedulas?open=${task.id}`}
            className="task-cedula-link"
            onClick={e => e.stopPropagation()}
            title="Ver Cédula de Aplicación"
          >
            <FiFileText size={13} /> Cédula
          </Link>
        )}
      </div>
    </div>
  );

  const groupedTasks = {
    overdue:   visibleTasks.filter(t => !archivedIds.has(t.id) && t.displayStatus.key === 'overdue'),
    pending:   visibleTasks.filter(t => !archivedIds.has(t.id) && t.displayStatus.key === 'pending'),
    completed: visibleTasks.filter(t => !archivedIds.has(t.id) && t.displayStatus.key === 'completed'),
    archived:  visibleTasks.filter(t => archivedIds.has(t.id)),
  };

  if (loading) return <div className="empty-state">Cargando actividades...</div>;
  if (error) return <div className="empty-state">Error: {error}</div>;

  const availableProductos = formProductos.filter(p => !formData.productos.find(fp => fp.productoId === p.id));

  return (
    <div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="task-tracking-header">
        <div className="task-tracking-controls">
          <button
            className={`btn-nueva-aplicacion${showNewTask ? ' active' : ''}`}
            onClick={() => showNewTask ? resetForm() : setShowNewTask(true)}
          >
            {showNewTask ? <FiX size={15} /> : <FiPlus size={15} />}
            {showNewTask ? 'Cancelar' : 'Nueva Actividad'}
          </button>
          <div className="filter-pills">
            <button onClick={() => setFilter('all')} className={`pill-btn ${filter === 'all' ? 'active' : ''}`}>Todas</button>
            <button onClick={() => setFilter('overdue')} className={`pill-btn ${filter === 'overdue' ? 'active' : ''}`}>Vencidas</button>
            <button onClick={() => setFilter('pending')} className={`pill-btn ${filter === 'pending' ? 'active' : ''}`}>Pendientes</button>
            <button onClick={() => setFilter('completed')} className={`pill-btn ${filter === 'completed' ? 'active' : ''}`}>Hechas</button>
            <button onClick={() => setFilter('unassigned')} className={`pill-btn ${filter === 'unassigned' ? 'active' : ''}`}>Sin Asignar</button>
          </div>
        </div>
      </div>

      {/* ── Formulario de nueva tarea de aplicación ── */}
      {showNewTask && (
        <div className="nueva-aplicacion-panel">
          <div className="na-main-layout">
            {/* ── Columna izquierda: campos + productos ── */}
            <div className="na-left-col">
              <div className="na-form-grid">
                <div className="form-group">
                  <label>Nombre de la actividad *</label>
                  <input
                    type="text"
                    placeholder="Ej: Fertilización Lote L2601"
                    value={formData.nombre}
                    onChange={e => setFormData(prev => ({ ...prev, nombre: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Lote *</label>
                  <select value={formData.loteId} onChange={e => setFormData(prev => ({ ...prev, loteId: e.target.value }))}>
                    <option value="">-- Seleccionar lote --</option>
                    {formLotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Responsable *</label>
                  <select value={formData.responsableId} onChange={e => setFormData(prev => ({ ...prev, responsableId: e.target.value }))}>
                    <option value="">-- Seleccionar responsable --</option>
                    {formUsers.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Fecha de ejecución *</label>
                  <input
                    type="date"
                    value={formData.fecha}
                    onChange={e => setFormData(prev => ({ ...prev, fecha: e.target.value }))}
                  />
                </div>
              </div>

              <div className="na-productos-section">
                <label className="na-productos-label">Productos a aplicar</label>
                <div className="na-producto-search-wrapper">
                  <input
                    className="na-producto-search-input"
                    type="text"
                    placeholder="🔍 Buscar producto del catálogo..."
                    value={prodSearch}
                    onChange={e => { setProdSearch(e.target.value); setShowProdDropdown(true); }}
                    onFocus={() => setShowProdDropdown(true)}
                    onBlur={() => setTimeout(() => setShowProdDropdown(false), 150)}
                  />
                  {showProdDropdown && (
                    <div className="na-producto-dropdown">
                      {availableProductos
                        .filter(p => p.nombreComercial.toLowerCase().includes(prodSearch.toLowerCase()))
                        .map(p => (
                          <button
                            key={p.id}
                            type="button"
                            className="na-producto-option"
                            onMouseDown={() => addProductLine(p.id)}
                          >
                            <span>{p.nombreComercial}</span>
                            <span className="na-producto-stock">stock: {p.stockActual} {p.unidad}</span>
                          </button>
                        ))
                      }
                      {availableProductos.filter(p => p.nombreComercial.toLowerCase().includes(prodSearch.toLowerCase())).length === 0 && (
                        <p className="na-producto-empty">Sin resultados</p>
                      )}
                    </div>
                  )}
                </div>

                {formData.productos.length > 0 && (
                  <table className="na-productos-table">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Cantidad</th>
                        <th>Unidad</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {formData.productos.map(p => (
                        <tr key={p.productoId}>
                          <td>{p.nombreComercial}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0"
                              value={p.cantidad}
                              onChange={e => updateProductCantidad(p.productoId, e.target.value)}
                              className="na-qty-input"
                            />
                          </td>
                          <td>{p.unidad}</td>
                          <td>
                            <button className="na-btn-remove" onClick={() => removeProductLine(p.productoId)}>
                              <FiX size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>{/* fin na-left-col */}

            {/* ── Columna derecha: plantillas ── */}
            <div className="na-right-col">
              <span className="na-plantillas-label">Plantillas guardadas</span>
              <div className="na-plantillas-list">
                {plantillas.length === 0 && (
                  <p className="na-plantillas-empty">Aún no hay plantillas guardadas.</p>
                )}
                {plantillas.map(p => (
                  <div key={p.id} className="na-plantilla-chip">
                    <button className="na-plantilla-apply" onClick={() => aplicarPlantilla(p)}>
                      ⚗ {p.nombre}
                    </button>
                    <button className="na-plantilla-delete" onClick={() => eliminarPlantilla(p.id)} title="Eliminar plantilla">
                      <FiX size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>{/* fin na-right-col */}
          </div>{/* fin na-main-layout */}

          <div className="na-form-actions">
            <button
              className={`btn-guardar-plantilla${plantillaSaved ? ' saved' : ''}`}
              onClick={guardarComoPlantilla}
              disabled={savingPlantilla || !formData.nombre}
              title="Guardar como plantilla reutilizable"
            >
              {plantillaSaved ? '✓ Guardada' : savingPlantilla ? 'Guardando...' : '📋 Guardar como plantilla'}
            </button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-secondary" onClick={resetForm}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleCreateTask} disabled={formSaving || !canSubmit}>
              {formSaving ? 'Guardando...' : 'Crear Actividad'}
            </button>
          </div>
        </div>
      )}

      {filter === 'all' ? (
        <>
          {groupedTasks.overdue.length === 0 && groupedTasks.pending.length === 0 && groupedTasks.completed.length === 0 && groupedTasks.archived.length === 0 && (
            <p className="empty-state">No hay actividades en esta categoría.</p>
          )}
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
            {groupedTasks.archived.length > 0 && (
              <div className="task-group task-group--archived">
                <h3 className="task-group-title task-group-title--archived">Archivadas</h3>
                <div className="tasks-grid">{groupedTasks.archived.map(renderTaskCard)}</div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {filteredTasks.length === 0 && <p className="empty-state">No hay actividades en esta categoría.</p>}
          <div className="tasks-grid">
            {filteredTasks.map(renderTaskCard)}
          </div>
        </>
      )}
    </div>
  );
}

export default TaskTracking;
