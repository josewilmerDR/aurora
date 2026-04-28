import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiPlus, FiX, FiFileText, FiMoreVertical, FiArchive, FiMenu } from 'react-icons/fi';
import '../styles/task-tracking.css';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';

// Mapping centralizado de badge variant + label para el tipo de tarea.
// Cada badge usa una primitiva aur-badge--* del sistema. Los emojis se
// mantienen como iconografía liviana inline (no react-icons) porque son
// glifos comunes y no semánticos.
const TASK_TAGS = {
  aplicacion: { variant: 'aur-badge--magenta', label: '⚗ Aplic.' },
  compra:     { variant: 'aur-badge--violet',  label: '🛒 Compra' },
  planilla:   { variant: 'aur-badge--green',   label: '💰 Planilla' },
};

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

function TaskTracking() {
  const apiFetch = useApiFetch();
  const { firebaseUser } = useUser();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const location = useLocation();
  const urlQuery = useQuery();
  const [filter, setFilter] = useState(urlQuery.get('filter') || 'all');

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
    const params = new URLSearchParams(location.search);
    if (newFilter === 'all') { params.delete('filter'); } else { params.set('filter', newFilter); }
    const qs = params.toString();
    navigate(qs ? `?${qs}` : location.pathname, { replace: true });
  };

  // --- Estado del formulario de nueva tarea ---
  // Abrir automáticamente si llegamos con ?new=1 (ej: desde el dashboard).
  const [showNewTask, setShowNewTask] = useState(urlQuery.get('new') === '1');
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
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  const FILTER_LABELS = {
    all: 'Todas',
    overdue: 'Vencidas',
    pending: 'Pendientes',
    completed: 'Hechas',
    unassigned: 'Sin Asignar',
  };

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

  // Si entramos con ?new=1 abrimos el form una vez y removemos el param
  // de la URL para que al recargar no se vuelva a abrir solo.
  useEffect(() => {
    if (urlQuery.get('new') === '1') {
      const params = new URLSearchParams(location.search);
      params.delete('new');
      const qs = params.toString();
      navigate(qs ? `?${qs}` : location.pathname, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const unarchiveTask = (taskId, e) => {
    e.stopPropagation();
    const next = new Set(archivedIds);
    next.delete(taskId);
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

  useEffect(() => {
    if (!filterMenuOpen) return;
    const handler = (e) => {
      if (!e.target.closest('.filter-hamburger') && !e.target.closest('.filter-bar'))
        setFilterMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterMenuOpen]);

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

  const canSubmit = formData.nombre && formData.fecha
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
      showToast('Tarea creada correctamente');
    } catch {
      showToast('Error al crear la tarea. Intenta de nuevo.', 'error');
    } finally {
      setFormSaving(false);
    }
  };

  // --- Task display logic ---
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
    if (filter === 'archived') return archivedIds.has(task.id);
    if (archivedIds.has(task.id)) return false;
    if (filter === 'all') return true;
    if (filter === 'unassigned') return !task.activity?.responsableId;
    return task.displayStatus.key === filter;
  });

  const renderTaskCard = (task) => {
    const isAplicacion = task.activity?.type === 'aplicacion'
      || (task.activity?.productos?.length > 0 && task.type !== 'SOLICITUD_COMPRA');
    const goToTask = () => {
      if (task.type === 'PLANILLA_PAGO') return navigate('/hr/planilla/fijo');
      if (isAplicacion) return navigate(`/aplicaciones/cedulas?open=${task.id}`);
      navigate(`/task/${task.id}`);
    };
    return (
      <div
        key={task.id}
        className={`aur-row task-row ${task.displayStatus.className}`}
        onClick={goToTask}
      >
        <span className="task-row__dot" title={task.displayStatus.text} />
        <span className="task-row__name">{task.activityName}</span>
        <span className="task-row__meta">
          {task.type !== 'PLANILLA_PAGO' && task.loteName && <>{task.loteName} · </>}
          {task.activity?.responsableId
            ? task.responsableName
            : <em className="task-row__unassigned">Sin asignar</em>}
        </span>
        <div className="task-row__tags">
          {task.activity?.type === 'aplicacion' && (
            <span className={`aur-badge ${TASK_TAGS.aplicacion.variant}`}>{TASK_TAGS.aplicacion.label}</span>
          )}
          {task.type === 'SOLICITUD_COMPRA' && (
            <span className={`aur-badge ${TASK_TAGS.compra.variant}`}>{TASK_TAGS.compra.label}</span>
          )}
          {task.type === 'PLANILLA_PAGO' && (
            <span className={`aur-badge ${TASK_TAGS.planilla.variant}`}>{TASK_TAGS.planilla.label}</span>
          )}
          {isAplicacion && (
            <span className="aur-chip task-cedula-chip" title="Ver cédula de aplicación">
              <FiFileText size={12} /> Cédula
            </span>
          )}
        </div>
        <span className="task-row__date">
          {new Date(task.dueDate).toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short' })}
        </span>
        <div className="task-kebab-menu">
          <button
            type="button"
            className="aur-icon-btn aur-icon-btn--sm"
            onClick={e => { e.stopPropagation(); setOpenKebabId(openKebabId === task.id ? null : task.id); }}
            title="Más opciones"
          >
            <FiMoreVertical size={14} />
          </button>
          {openKebabId === task.id && (
            <div className="task-kebab-dropdown">
              {archivedIds.has(task.id) ? (
                <button type="button" onClick={e => unarchiveTask(task.id, e)}>Desarchivar</button>
              ) : (
                <button type="button" onClick={e => archiveTask(task.id, e)}>Archivar</button>
              )}
              <button type="button" className="task-kebab-dropdown__delete" onClick={e => dismissTask(task.id, e)}>Eliminar del panel</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const allTasksSorted = visibleTasks
    .filter(t => !archivedIds.has(t.id))
    .sort((a, b) => {
      const aCompleted = a.displayStatus.key === 'completed';
      const bCompleted = b.displayStatus.key === 'completed';
      if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;
      // both completed → most recent first; both not completed → most urgent first
      return aCompleted
        ? new Date(b.dueDate) - new Date(a.dueDate)
        : new Date(a.dueDate) - new Date(b.dueDate);
    });

  if (loading) return (
    <div className="aur-sheet">
      <div className="aur-page-loading" />
    </div>
  );
  if (error) return (
    <div className="aur-sheet">
      <div className="empty-state">Error: {error}</div>
    </div>
  );

  const availableProductos = formProductos.filter(p => !formData.productos.find(fp => fp.productoId === p.id));

  return (
    <div className="aur-sheet">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h1 className="aur-sheet-title">Seguimiento de tareas</h1>
          <p className="aur-sheet-subtitle">
            Lista, filtros y plantillas de tareas pendientes y completadas.
          </p>
        </div>
        <div className="aur-sheet-header-actions">
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm task-new-btn"
            onClick={() => showNewTask ? resetForm() : setShowNewTask(true)}
          >
            {showNewTask ? <FiX size={14} /> : <FiPlus size={14} />}
            {showNewTask ? 'Cancelar' : 'Nueva tarea'}
          </button>
        </div>
      </header>

      {/* ── Filtros desktop (chips) ────────────────────────────────────── */}
      <div className="filter-pills" role="tablist">
        {Object.entries(FILTER_LABELS).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={`aur-chip aur-chip--ghost${filter === key ? ' is-active' : ''}`}
            onClick={() => handleFilterChange(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Filtros mobile (barra unificada) ──────────────────────────── */}
      <div className="filter-bar">
        <button
          type="button"
          className="filter-bar__menu-btn"
          onClick={() => setFilterMenuOpen(o => !o)}
          title="Filtrar"
        >
          <FiMenu size={17} />
        </button>
        <span className="filter-bar__label">{FILTER_LABELS[filter] ?? 'Todas'}</span>
        <button
          type="button"
          className="filter-bar__add-btn"
          onClick={() => showNewTask ? resetForm() : setShowNewTask(true)}
          title={showNewTask ? 'Cancelar' : 'Nueva tarea'}
        >
          {showNewTask ? <FiX size={17} /> : <FiPlus size={17} />}
        </button>
        {filterMenuOpen && (
          <div className="filter-bar__dropdown">
            {Object.entries(FILTER_LABELS).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`filter-hamburger__option${filter === key ? ' active' : ''}`}
                onClick={() => { handleFilterChange(key); setFilterMenuOpen(false); }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Formulario de nueva tarea de aplicación ── */}
      {showNewTask && (
        <section className="aur-section nueva-task-panel">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiPlus size={14} /></span>
            <h3 className="aur-section-title">Nueva tarea</h3>
          </div>

          <div className="nueva-task-grid">
            {/* ── Columna principal: campos + productos ── */}
            <div className="nueva-task-main">
              <div className="nueva-task-fields">
                <div className="aur-field">
                  <label className="aur-field-label" htmlFor="nt-nombre">Nombre de la tarea *</label>
                  <input
                    id="nt-nombre"
                    type="text"
                    className="aur-input"
                    placeholder="Ej: Fertilización Lote L2601"
                    value={formData.nombre}
                    onChange={e => setFormData(prev => ({ ...prev, nombre: e.target.value }))}
                  />
                </div>
                <div className="aur-field">
                  <label className="aur-field-label" htmlFor="nt-lote">Lote</label>
                  <select
                    id="nt-lote"
                    className="aur-select"
                    value={formData.loteId}
                    onChange={e => setFormData(prev => ({ ...prev, loteId: e.target.value }))}
                  >
                    <option value="">— Seleccionar lote —</option>
                    {formLotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                  </select>
                </div>
                <div className="aur-field">
                  <label className="aur-field-label" htmlFor="nt-resp">Responsable</label>
                  <select
                    id="nt-resp"
                    className="aur-select"
                    value={formData.responsableId}
                    onChange={e => setFormData(prev => ({ ...prev, responsableId: e.target.value }))}
                  >
                    <option value="">— Sin asignar —</option>
                    {formUsers.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
                <div className="aur-field">
                  <label className="aur-field-label" htmlFor="nt-fecha">Fecha de ejecución *</label>
                  <input
                    id="nt-fecha"
                    type="date"
                    className="aur-input"
                    value={formData.fecha}
                    onChange={e => setFormData(prev => ({ ...prev, fecha: e.target.value }))}
                  />
                </div>
              </div>

              <div className="aur-field nueva-task-products">
                <label className="aur-field-label" htmlFor="nt-prod-search">Productos a aplicar</label>
                <div className="nueva-task-prod-search">
                  <input
                    id="nt-prod-search"
                    type="text"
                    className="aur-input nueva-task-prod-input"
                    placeholder="🔍 Buscar producto del catálogo..."
                    value={prodSearch}
                    onChange={e => { setProdSearch(e.target.value); setShowProdDropdown(true); }}
                    onFocus={() => setShowProdDropdown(true)}
                    onBlur={() => setTimeout(() => setShowProdDropdown(false), 150)}
                  />
                  {showProdDropdown && (
                    <div className="nueva-task-prod-dropdown">
                      {availableProductos
                        .filter(p => p.nombreComercial.toLowerCase().includes(prodSearch.toLowerCase()))
                        .map(p => (
                          <button
                            key={p.id}
                            type="button"
                            className="nueva-task-prod-option"
                            onMouseDown={() => addProductLine(p.id)}
                          >
                            <span>{p.nombreComercial}</span>
                            <span className="nueva-task-prod-stock">stock: {p.stockActual} {p.unidad}</span>
                          </button>
                        ))
                      }
                      {availableProductos.filter(p => p.nombreComercial.toLowerCase().includes(prodSearch.toLowerCase())).length === 0 && (
                        <p className="nueva-task-prod-empty">Sin resultados</p>
                      )}
                    </div>
                  )}
                </div>

                {formData.productos.length > 0 && (
                  <div className="aur-table-wrap nueva-task-prod-table">
                    <table className="aur-table">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th className="aur-td-num">Cantidad</th>
                          <th>Unidad</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {formData.productos.map(p => (
                          <tr key={p.productoId}>
                            <td>{p.nombreComercial}</td>
                            <td className="aur-td-num">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0"
                                className="aur-input aur-input--num nueva-task-qty"
                                value={p.cantidad}
                                onChange={e => updateProductCantidad(p.productoId, e.target.value)}
                              />
                            </td>
                            <td>{p.unidad}</td>
                            <td>
                              <button
                                type="button"
                                className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                                onClick={() => removeProductLine(p.productoId)}
                                title="Quitar producto"
                              >
                                <FiX size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* ── Columna lateral: plantillas ── */}
            <aside className="nueva-task-aside">
              <div className="nueva-task-aside-label">Plantillas guardadas</div>
              {plantillas.length === 0 ? (
                <p className="nueva-task-empty-msg">Aún no hay plantillas guardadas.</p>
              ) : (
                <div className="nueva-task-plantillas-list">
                  {plantillas.map(p => (
                    <div key={p.id} className="nueva-task-plantilla-chip">
                      <button
                        type="button"
                        className="nueva-task-plantilla-apply"
                        onClick={() => aplicarPlantilla(p)}
                      >
                        ⚗ {p.nombre}
                      </button>
                      <button
                        type="button"
                        className="nueva-task-plantilla-delete"
                        onClick={() => eliminarPlantilla(p.id)}
                        title="Eliminar plantilla"
                      >
                        <FiX size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>

          <div className="aur-form-actions nueva-task-actions">
            <button
              type="button"
              className={`aur-chip aur-chip--ghost nueva-task-save-tpl${plantillaSaved ? ' is-saved' : ''}`}
              onClick={guardarComoPlantilla}
              disabled={savingPlantilla || !formData.nombre}
              title="Guardar como plantilla reutilizable"
            >
              {plantillaSaved ? '✓ Guardada' : savingPlantilla ? 'Guardando…' : '📋 Guardar como plantilla'}
            </button>
            <div className="nueva-task-actions-spacer" />
            <button type="button" className="aur-btn-text" onClick={resetForm} disabled={formSaving}>
              Cancelar
            </button>
            <button
              type="button"
              className="aur-btn-pill"
              onClick={handleCreateTask}
              disabled={formSaving || !canSubmit}
            >
              {formSaving ? 'Guardando…' : 'Crear tarea'}
            </button>
          </div>
        </section>
      )}

      {!showNewTask && (
        filter === 'all' ? (
          <>
            {archivedIds.size > 0 && (
              <button
                type="button"
                className="aur-chip aur-chip--ghost archived-shortcut"
                onClick={() => handleFilterChange('archived')}
              >
                <FiArchive size={13} />
                <span>Archivadas</span>
                <span className="archived-shortcut__count">{archivedIds.size}</span>
              </button>
            )}
            {allTasksSorted.length === 0
              ? <div className="empty-state">No hay tareas en esta categoría.</div>
              : <div className="aur-list tasks-list">{allTasksSorted.map(renderTaskCard)}</div>
            }
          </>
        ) : filter === 'archived' ? (
          <>
            <button
              type="button"
              className="aur-btn-text archived-back"
              onClick={() => handleFilterChange('all')}
            >
              ← Volver a Todas
            </button>
            {filteredTasks.length === 0
              ? <div className="empty-state">No hay tareas archivadas.</div>
              : <div className="aur-list tasks-list archived-grid">{filteredTasks.map(renderTaskCard)}</div>
            }
          </>
        ) : (
          <>
            {filteredTasks.length === 0 && <div className="empty-state">No hay tareas en esta categoría.</div>}
            <div className="aur-list tasks-list">
              {filteredTasks.map(renderTaskCard)}
            </div>
          </>
        )
      )}
    </div>
  );
}

export default TaskTracking;
