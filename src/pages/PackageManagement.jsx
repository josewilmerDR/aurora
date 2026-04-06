import { useState, useEffect, useRef } from 'react';
import './PackageManagement.css';
import { FiEdit, FiTrash2, FiPlus, FiX, FiEye, FiSearch, FiCopy, FiPackage } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';

function PackageManagement() {
  const apiFetch = useApiFetch();
  const [packages, setPackages] = useState([]);
  const [users, setUsers] = useState([]);
  const [productos, setProductos] = useState([]);
  const [plantillas, setPlantillas] = useState([]);
  const [calibraciones, setCalibraciones] = useState([]);
  const [formData, setFormData] = useState({
    id: null,
    nombrePaquete: '',
    descripcion: '',
    tipoCosecha: '',
    etapaCultivo: '',
    tecnicoResponsable: '',
    activities: []
  });
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [expandedActivities, setExpandedActivities] = useState(new Set());
  const [focusedActivity, setFocusedActivity] = useState(null);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const [pendingDeleteIdx, setPendingDeleteIdx] = useState(null);
  const [pendingDeletePkgId, setPendingDeletePkgId] = useState(null);
  const [pkgDepsModal, setPkgDepsModal] = useState(null);
  const [prodOpenIdx, setProdOpenIdx] = useState(null);
  const [prodSearch, setProdSearch] = useState('');
  const [prodDropdownPos, setProdDropdownPos] = useState({ top: 0, left: 0 });

  const openProdCombo = (index, wrapEl) => {
    const rect = wrapEl.getBoundingClientRect();
    setProdDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setProdOpenIdx(index);
  };

  useEffect(() => {
    if (prodOpenIdx === null) return;
    const close = () => { setProdOpenIdx(null); setProdSearch(''); };
    const handler = (e) => {
      if (!e.target.closest('.pkg-prod-input-wrap') && !e.target.closest('.pkg-prod-dropdown')) close();
    };
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [prodOpenIdx]);

  useEffect(() => {
    apiFetch('/api/packages').then(res => res.json()).then(setPackages).catch(console.error).finally(() => setLoading(false));
    apiFetch('/api/users').then(res => res.json()).then(setUsers).catch(console.error);
    apiFetch('/api/productos').then(res => res.json()).then(setProductos).catch(console.error);
    apiFetch('/api/task-templates').then(res => res.json()).then(setPlantillas).catch(console.error);
    apiFetch('/api/calibraciones').then(res => res.json()).then(setCalibraciones).catch(console.error);
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
      ...(name === 'tipoCosecha' && value === 'Semillero' ? { etapaCultivo: 'N/A' } : {}),
    }));
  };

  const handleActivityChange = (index, field, value) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[index] = { ...updatedActivities[index], [field]: value };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  const addActivity = () => {
    setFormData(prev => ({
      ...prev,
      activities: [...prev.activities, { day: '', name: '', responsableId: '', calibracionId: '', productos: [] }]
    }));
  };

  const duplicateActivity = (index) => {
    const copy = JSON.parse(JSON.stringify(formData.activities[index]));
    if (copy.name) copy.name = `Copia de ${copy.name}`;
    const updatedActivities = [
      ...formData.activities.slice(0, index + 1),
      copy,
      ...formData.activities.slice(index + 1),
    ];
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  const removeActivity = (index) => {
    setFormData(prev => ({ ...prev, activities: prev.activities.filter((_, i) => i !== index) }));
    setPendingDeleteIdx(null);
    setExpandedActivities(prev => {
      const next = new Set();
      prev.forEach(i => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
  };

  const toggleActivityExpand = (index) => {
    setExpandedActivities(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const addProductToActivity = (activityIndex, productoId) => {
    if (!productoId) return;
    const producto = productos.find(p => p.id === productoId);
    if (!producto) return;
    const updatedActivities = [...formData.activities];
    const existing = updatedActivities[activityIndex].productos || [];
    if (existing.find(p => p.productoId === productoId)) return;
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      productos: [
        ...existing,
        {
          productoId: producto.id,
          nombreComercial: producto.nombreComercial,
          cantidadPorHa: 0,
          unidad: producto.unidad,
          periodoReingreso: producto.periodoReingreso,
          periodoACosecha: producto.periodoACosecha,
        },
      ],
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  const removeProductFromActivity = (activityIndex, productoId) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      productos: updatedActivities[activityIndex].productos.filter(p => p.productoId !== productoId),
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  const updateProductCantidad = (activityIndex, productoId, newCantidad) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      productos: updatedActivities[activityIndex].productos.map(p =>
        p.productoId === productoId ? { ...p, cantidadPorHa: parseFloat(newCantidad) || 0 } : p
      ),
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  const aplicarPlantillaAActividad = (activityIndex, plantillaId) => {
    const plantilla = plantillas.find(p => p.id === plantillaId);
    if (!plantilla) return;
    const productosDeActividad = plantilla.productos
      .map(tp => {
        const cat = productos.find(p => p.id === tp.productoId);
        if (!cat) return null;
        return {
          productoId: cat.id,
          nombreComercial: cat.nombreComercial,
          cantidadPorHa: tp.cantidad || 0,
          unidad: cat.unidad,
          periodoReingreso: cat.periodoReingreso,
          periodoACosecha: cat.periodoACosecha,
        };
      })
      .filter(Boolean);
    const updatedActivities = [...formData.activities];
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      name: plantilla.nombre || updatedActivities[activityIndex].name,
      responsableId: plantilla.responsableId || updatedActivities[activityIndex].responsableId,
      productos: productosDeActividad,
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
    setExpandedActivities(prev => new Set(prev).add(activityIndex));
  };

  const handleEdit = (pkg) => {
    const normalizedActivities = (pkg.activities || [])
      .map(a => ({ type: 'notificacion', productos: [], ...a }))
      .sort((a, b) => Number(a.day) - Number(b.day));
    setFormData({ ...pkg, activities: normalizedActivities });
    setIsEditing(true);
    setIsFormOpen(true);
    setExpandedActivities(new Set());
    window.scrollTo(0, 0);
  };

  const resetForm = () => {
    setFormData({ id: null, nombrePaquete: '', descripcion: '', tipoCosecha: '', etapaCultivo: '', tecnicoResponsable: '', activities: [] });
    setIsEditing(false);
    setIsFormOpen(false);
    setExpandedActivities(new Set());
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/packages/${formData.id}` : '/api/packages';
    const method = isEditing ? 'PUT' : 'POST';
    const sortedActivities = [...formData.activities].sort((a, b) => Number(a.day) - Number(b.day));
    const body = {
      ...formData,
      activities: sortedActivities.map(a => ({
        ...a,
        type: (a.productos && a.productos.length > 0) ? 'aplicacion' : 'notificacion',
      })),
    };
    try {
      const response = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Error al guardar el paquete');
      const updatedPackages = await apiFetch('/api/packages').then(res => res.json());
      setPackages(updatedPackages);
      resetForm();
      showToast(isEditing ? 'Paquete actualizado correctamente' : 'Paquete guardado correctamente');
    } catch (error) {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };

  const handleDuplicate = async (pkg) => {
    const body = {
      nombrePaquete: `Copia de ${pkg.nombrePaquete}`,
      tipoCosecha: pkg.tipoCosecha,
      etapaCultivo: pkg.etapaCultivo,
      tecnicoResponsable: pkg.tecnicoResponsable || '',
      activities: pkg.activities || [],
    };
    try {
      const response = await apiFetch('/api/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      const updatedPackages = await apiFetch('/api/packages').then(res => res.json());
      setPackages(updatedPackages);
      showToast(`Paquete duplicado: "${body.nombrePaquete}"`);
    } catch {
      showToast('Error al duplicar el paquete.', 'error');
    }
  };

  const handleDeleteClick = async (pkg) => {
    try {
      const [lotesData, gruposData] = await Promise.all([
        apiFetch('/api/lotes').then(r => r.json()),
        apiFetch('/api/grupos').then(r => r.json()),
      ]);
      const depLotes = lotesData.filter(l => l.paqueteId === pkg.id);
      const depGrupos = gruposData.filter(g => g.paqueteId === pkg.id);
      if (depLotes.length > 0 || depGrupos.length > 0) {
        setPkgDepsModal({ name: pkg.nombrePaquete, lotes: depLotes, grupos: depGrupos });
      } else {
        setPendingDeletePkgId(pkg.id);
      }
    } catch {
      showToast('Error al verificar dependencias.', 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      const response = await apiFetch(`/api/packages/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Error al eliminar el paquete');
      setPackages(packages.filter(p => p.id !== id));
      setPendingDeletePkgId(null);
      showToast('Paquete eliminado correctamente');
    } catch (error) {
      showToast('Error al eliminar el paquete.', 'error');
    }
  };

  return (
    <div className="pkg-page-wrapper">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {pkgDepsModal && (
        <div className="pkg-deps-overlay" onClick={() => setPkgDepsModal(null)}>
          <div className="pkg-deps-modal" onClick={e => e.stopPropagation()}>
            <h3>No es posible eliminar este paquete</h3>
            <p>
              El paquete <strong>"{pkgDepsModal.name}"</strong> está siendo usado por los siguientes registros.
              Por favor, resuelve estas dependencias antes de eliminarlo.
            </p>
            {pkgDepsModal.lotes.length > 0 && (
              <>
                <p className="pkg-deps-section-label">Lotes</p>
                <ul className="pkg-deps-list">
                  {pkgDepsModal.lotes.map(l => <li key={l.id}>{l.nombreLote}</li>)}
                </ul>
              </>
            )}
            {pkgDepsModal.grupos.length > 0 && (
              <>
                <p className="pkg-deps-section-label">Grupos</p>
                <ul className="pkg-deps-list">
                  {pkgDepsModal.grupos.map(g => <li key={g.id}>{g.nombreGrupo}</li>)}
                </ul>
              </>
            )}
            <div className="pkg-deps-actions">
              <button className="btn btn-secondary" onClick={() => setPkgDepsModal(null)}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Spinner de carga ── */}
      {loading && <div className="pkg-page-loading" />}

      {/* ── Estado vacío ── */}
      {!loading && packages.length === 0 && !isFormOpen && (
        <div className="pkg-empty-state">
          <FiPackage size={36} />
          <p>No hay paquetes técnicos creados aún.</p>
          <button className="btn btn-primary" onClick={() => setIsFormOpen(true)}>
            <FiPlus size={15} /> Crear el primero
          </button>
        </div>
      )}

      {!loading && (packages.length > 0 || isFormOpen) && <div className="pkg-page-header">
        <h1 className="pkg-page-title">Paquetes de Tareas</h1>
        {!isFormOpen && packages.length > 0 && (
          <button className="btn btn-primary" onClick={() => setIsFormOpen(true)}>
            <FiPlus /> Nuevo Paquete
          </button>
        )}
      </div>}
      {!loading && (packages.length > 0 || isFormOpen) && <div className="lote-management-layout">
      <div className="form-card">
        {isFormOpen ? (
          <>
          <h2>{isEditing ? 'Editando Paquete' : 'Nuevo Paquete de Tareas'}</h2>
          <form onSubmit={handleSubmit} className="lote-form">
          <div className="form-grid">
            <div className="form-control">
              <label htmlFor="nombrePaquete">Nombre del Paquete</label>
              <input id="nombrePaquete" name="nombrePaquete" value={formData.nombrePaquete} onChange={handleInputChange} maxLength={19} required />
            </div>
            <div className="form-control form-control--full">
              <label htmlFor="descripcion">Descripción del Paquete</label>
              <textarea
                id="descripcion"
                name="descripcion"
                value={formData.descripcion}
                onChange={handleInputChange}
                placeholder="Ej: Paquete para la etapa inicial de desarrollo, incluye aplicaciones preventivas contra hongos y fertilización base."
                rows={3}
              />
            </div>
            <div className="form-control">
              <label htmlFor="tipoCosecha">Tipo de Cosecha</label>
              <select id="tipoCosecha" name="tipoCosecha" value={formData.tipoCosecha} onChange={handleInputChange} required>
                <option value="">-- Seleccionar --</option>
                <option value="I Cosecha">I Cosecha</option>
                <option value="II Cosecha">II Cosecha</option>
                <option value="III Cosecha">III Cosecha</option>
                <option value="Semillero">Semillero</option>
              </select>
            </div>
            <div className="form-control">
              <label htmlFor="etapaCultivo">Etapa del Cultivo</label>
              <select id="etapaCultivo" name="etapaCultivo" value={formData.etapaCultivo} onChange={handleInputChange} required>
                <option value="">-- Seleccionar --</option>
                <option value="Desarrollo">Desarrollo</option>
                <option value="Postforza">Postforza</option>
                <option value="N/A">N/A</option>
              </select>
            </div>
            <div className="form-control">
              <label htmlFor="tecnicoResponsable">Técnico responsable</label>
              <input
                id="tecnicoResponsable"
                name="tecnicoResponsable"
                value={formData.tecnicoResponsable}
                onChange={handleInputChange}
                placeholder="Nombre del técnico responsable"
              />
            </div>
          </div>

          <h3>Actividades Programadas</h3>
          <div className="activities-table-wrapper">
            <table className="activities-table">
              <thead>
                <tr>
                  <th className="col-day">Día</th>
                  <th className="col-name">Actividad</th>
                  <th className="col-cal">Volumen/Calibración</th>
                  <th className="col-user">Responsable</th>
                  <th className="col-action"></th>
                </tr>
              </thead>
              <tbody>
                {formData.activities.map((activity, index) => (
                  <>
                    <tr key={`row-${index}`}>
                      <td><input value={activity.day} onChange={(e) => handleActivityChange(index, 'day', e.target.value)} type="number" required /></td>
                      <td>
                        <div
                          className="activity-name-cell"
                          onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget)) {
                              setFocusedActivity(null);
                            }
                          }}
                        >
                          {plantillas.length > 0 && focusedActivity === index && (
                            <select
                              className="plantilla-inline-select"
                              value=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  aplicarPlantillaAActividad(index, e.target.value);
                                  setFocusedActivity(null);
                                }
                              }}
                            >
                              <option value="">-- Cargar desde plantilla --</option>
                              {plantillas.map(p => (
                                <option key={p.id} value={p.id}>{p.nombre}</option>
                              ))}
                            </select>
                          )}
                          <input
                            value={activity.name}
                            onChange={(e) => handleActivityChange(index, 'name', e.target.value)}
                            placeholder="Nombre de la actividad"
                            required
                            onFocus={() => setFocusedActivity(index)}
                          />
                        </div>
                      </td>
                      <td>
                        <select value={activity.calibracionId || ''} onChange={(e) => handleActivityChange(index, 'calibracionId', e.target.value)}>
                          <option value="">-- Ninguna --</option>
                          {calibraciones.map(cal => (
                            <option key={cal.id} value={cal.id}>{cal.nombre}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select value={activity.responsableId} onChange={(e) => handleActivityChange(index, 'responsableId', e.target.value)}>
                          <option value="">-- Asignar --</option>
                          {users.map(user => <option key={user.id} value={user.id}>{user.nombre}</option>)}
                        </select>
                      </td>
                      <td>
                        <div className="activity-row-actions">
                          {pendingDeleteIdx === index ? (
                            <div className="activity-delete-confirm">
                              <span>¿Eliminar?</span>
                              <button type="button" className="btn-confirm-yes" onClick={() => removeActivity(index)}>Sí</button>
                              <button type="button" className="btn-confirm-no" onClick={() => setPendingDeleteIdx(null)}>No</button>
                            </div>
                          ) : (
                            <>
                              <button type="button" onClick={() => setPendingDeleteIdx(index)} className="icon-btn pkg-action-btn" title="Eliminar Actividad">
                                <FiX size={16} />
                              </button>
                              <button type="button" onClick={() => duplicateActivity(index)} className="icon-btn pkg-action-btn" title="Duplicar Actividad">
                                <FiCopy size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleActivityExpand(index)}
                                className={`icon-btn pkg-action-btn${expandedActivities.has(index) ? ' expanded' : ''}`}
                                title={expandedActivities.has(index) ? 'Ocultar productos' : 'Agregar productos'}
                              >
                                <FiEye size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedActivities.has(index) && (
                      <tr key={`products-${index}`} className="products-subrow-tr">
                        <td colSpan="5">
                          <div className="products-subrow">
                            <div className="products-subrow-header">
                              <span className="products-subrow-label">Productos de mezcla:</span>
                            </div>
                            <div className="products-tags">
                              {(activity.productos || []).map(p => (
                                <span key={p.productoId} className="product-tag">
                                  <strong>{p.nombreComercial}</strong>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={p.cantidadPorHa}
                                    onChange={(e) => updateProductCantidad(index, p.productoId, e.target.value)}
                                    className="product-tag-qty"
                                    title="Cantidad por Ha"
                                    data-prod-qty={`${index}-${p.productoId}`}
                                  />
                                  <span className="product-tag-unit">{p.unidad}/Ha</span>
                                  <button
                                    type="button"
                                    className="product-tag-remove"
                                    onClick={() => removeProductFromActivity(index, p.productoId)}
                                    title="Quitar producto"
                                  >
                                    <FiX size={12} />
                                  </button>
                                </span>
                              ))}
                              <div className="pkg-prod-combo">
                                <div
                                  className="pkg-prod-input-wrap"
                                  onClick={(e) => openProdCombo(index, e.currentTarget)}
                                >
                                  <FiSearch size={13} />
                                  <input
                                    type="text"
                                    placeholder="+ Agregar producto..."
                                    value={prodOpenIdx === index ? prodSearch : ''}
                                    onChange={e => { setProdSearch(e.target.value); openProdCombo(index, e.currentTarget.closest('.pkg-prod-input-wrap')); }}
                                    onFocus={e => openProdCombo(index, e.currentTarget.closest('.pkg-prod-input-wrap'))}
                                  />
                                </div>
                                {prodOpenIdx === index && (
                                  <div className="pkg-prod-dropdown" style={{ top: prodDropdownPos.top, left: prodDropdownPos.left }}>
                                    {productos
                                      .filter(p => !(activity.productos || []).find(ap => ap.productoId === p.id))
                                      .filter(p => !prodSearch || p.nombreComercial?.toLowerCase().includes(prodSearch.toLowerCase()) || p.ingredienteActivo?.toLowerCase().includes(prodSearch.toLowerCase()))
                                      .map(p => (
                                        <button
                                          type="button"
                                          key={p.id}
                                          className="pkg-prod-option"
                                          onClick={() => {
                                            addProductToActivity(index, p.id);
                                            setProdSearch('');
                                            setProdOpenIdx(null);
                                            setTimeout(() => {
                                              const el = document.querySelector(`[data-prod-qty="${index}-${p.id}"]`);
                                              if (el) { el.focus(); el.select(); }
                                            }, 0);
                                          }}
                                        >
                                          <span className="pkg-prod-name">{p.nombreComercial}</span>
                                          {p.ingredienteActivo && <span className="pkg-prod-ing">{p.ingredienteActivo}</span>}
                                        </button>
                                      ))
                                    }
                                    {productos
                                      .filter(p => !(activity.productos || []).find(ap => ap.productoId === p.id))
                                      .filter(p => !prodSearch || p.nombreComercial?.toLowerCase().includes(prodSearch.toLowerCase()) || p.ingredienteActivo?.toLowerCase().includes(prodSearch.toLowerCase()))
                                      .length === 0 && (
                                      <p className="pkg-prod-empty">Sin resultados</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <div className="add-activity-btn-container">
            <button type="button" onClick={addActivity} className="btn btn-secondary">
              <FiPlus />
              Añadir Actividad
            </button>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">{isEditing ? 'Actualizar Paquete' : 'Guardar Paquete'}</button>
            <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>
          </div>
        </form>
        </>
        ) : (
          <div className="pkg-form-placeholder">
            <p>Selecciona un paquete de la lista para editarlo,<br />o crea uno nuevo con el botón de arriba.</p>
          </div>
        )}
      </div>

      {packages.length > 0 && <div className="list-card">
        <h2>Paquetes Existentes</h2>
        <ul className="info-list">
          {packages.map(pkg => (
            <li key={pkg.id}>
              <div>
                <div className="item-main-text">{pkg.nombrePaquete}</div>
                <div className="package-sub-info">
                  <span>{pkg.tipoCosecha}</span> | <span>{pkg.etapaCultivo}</span> | <span>{pkg.activities.length} actividades</span>
                </div>
              </div>
              <div className="lote-actions">
                {pendingDeletePkgId === pkg.id ? (
                  <div className="activity-delete-confirm">
                    <span>¿Eliminar?</span>
                    <button className="btn-confirm-yes" onClick={() => handleDelete(pkg.id)}>Sí</button>
                    <button className="btn-confirm-no" onClick={() => setPendingDeletePkgId(null)}>No</button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => handleEdit(pkg)} className="icon-btn" title="Editar">
                      <FiEdit size={18} />
                    </button>
                    <button onClick={() => handleDuplicate(pkg)} className="icon-btn" title="Duplicar paquete">
                      <FiCopy size={17} />
                    </button>
                    <button onClick={() => handleDeleteClick(pkg)} className="icon-btn delete" title="Eliminar">
                      <FiTrash2 size={18} />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>}
      </div>}
    </div>
  );
}

export default PackageManagement;
