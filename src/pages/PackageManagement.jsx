import { useState, useEffect } from 'react';
import './PackageManagement.css';
import { FiEdit, FiTrash2, FiPlus, FiX, FiEye } from 'react-icons/fi';
import Toast from '../components/Toast';

function PackageManagement() {
  const [packages, setPackages] = useState([]);
  const [users, setUsers] = useState([]);
  const [productos, setProductos] = useState([]);
  const [plantillas, setPlantillas] = useState([]);
  const [formData, setFormData] = useState({
    id: null,
    nombrePaquete: '',
    tipoCosecha: '',
    etapaCultivo: '',
    activities: []
  });
  const [isEditing, setIsEditing] = useState(false);
  const [expandedActivities, setExpandedActivities] = useState(new Set());
  const [hoveredActivity, setHoveredActivity] = useState(null);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    fetch('/api/packages').then(res => res.json()).then(setPackages).catch(console.error);
    fetch('/api/users').then(res => res.json()).then(setUsers).catch(console.error);
    fetch('/api/productos').then(res => res.json()).then(setProductos).catch(console.error);
    fetch('/api/task-templates').then(res => res.json()).then(setPlantillas).catch(console.error);
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
      activities: [...prev.activities, { day: '', name: '', responsableId: '', productos: [] }]
    }));
  };

  const removeActivity = (index) => {
    setFormData(prev => ({ ...prev, activities: prev.activities.filter((_, i) => i !== index) }));
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
    const normalizedActivities = (pkg.activities || []).map(a => ({
      type: 'notificacion',
      productos: [],
      ...a,
    }));
    setFormData({ ...pkg, activities: normalizedActivities });
    setIsEditing(true);
    setExpandedActivities(new Set());
    window.scrollTo(0, 0);
  };

  const resetForm = () => {
    setFormData({ id: null, nombrePaquete: '', tipoCosecha: '', etapaCultivo: '', activities: [] });
    setIsEditing(false);
    setExpandedActivities(new Set());
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/packages/${formData.id}` : '/api/packages';
    const method = isEditing ? 'PUT' : 'POST';
    const body = {
      ...formData,
      activities: formData.activities.map(a => ({
        ...a,
        type: (a.productos && a.productos.length > 0) ? 'aplicacion' : 'notificacion',
      })),
    };
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Error al guardar el paquete');
      const updatedPackages = await fetch('/api/packages').then(res => res.json());
      setPackages(updatedPackages);
      resetForm();
      showToast(isEditing ? 'Paquete actualizado correctamente' : 'Paquete guardado correctamente');
    } catch (error) {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('¿Estás seguro?')) {
      try {
        const response = await fetch(`/api/packages/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Error al eliminar el paquete');
        setPackages(packages.filter(p => p.id !== id));
        showToast('Paquete eliminado correctamente');
      } catch (error) {
        showToast('Error al eliminar el paquete.', 'error');
      }
    }
  };

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="form-card">
        <h2>{isEditing ? 'Editando Paquete' : 'Nuevo Paquete de Tareas'}</h2>
        <form onSubmit={handleSubmit} className="lote-form">
          <div className="form-grid">
            <div className="form-control">
              <label htmlFor="nombrePaquete">Nombre del Paquete</label>
              <input id="nombrePaquete" name="nombrePaquete" value={formData.nombrePaquete} onChange={handleInputChange} required />
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
          </div>

          <h3>Actividades Programadas</h3>
          <div className="activities-table-wrapper">
            <table className="activities-table">
              <thead>
                <tr>
                  <th className="col-day">Día</th>
                  <th className="col-name">Actividad</th>
                  <th className="col-user">Responsable</th>
                  <th className="col-action"></th>
                </tr>
              </thead>
              <tbody>
                {formData.activities.map((activity, index) => (
                  <>
                    <tr key={`row-${index}`} onMouseEnter={() => setHoveredActivity(index)} onMouseLeave={() => setHoveredActivity(null)}>
                      <td><input value={activity.day} onChange={(e) => handleActivityChange(index, 'day', e.target.value)} type="number" required /></td>
                      <td>
                        <div className="activity-name-cell">
                          {plantillas.length > 0 && hoveredActivity === index && (
                            <select
                              className="plantilla-inline-select"
                              value=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  aplicarPlantillaAActividad(index, e.target.value);
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
                          />
                        </div>
                      </td>
                      <td>
                        <select value={activity.responsableId} onChange={(e) => handleActivityChange(index, 'responsableId', e.target.value)}>
                          <option value="">-- Asignar --</option>
                          {users.map(user => <option key={user.id} value={user.id}>{user.nombre}</option>)}
                        </select>
                      </td>
                      <td>
                        <div className="activity-row-actions">
                          <button type="button" onClick={() => removeActivity(index)} className="icon-btn pkg-action-btn" title="Eliminar Actividad">
                            <FiX size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleActivityExpand(index)}
                            className={`icon-btn pkg-action-btn${expandedActivities.has(index) ? ' expanded' : ''}`}
                            title={expandedActivities.has(index) ? 'Ocultar productos' : 'Agregar productos'}
                          >
                            <FiEye size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedActivities.has(index) && (
                      <tr key={`products-${index}`} className="products-subrow-tr">
                        <td colSpan="4">
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
                              <select
                                className="add-product-select"
                                onChange={(e) => { addProductToActivity(index, e.target.value); e.target.value = ''; }}
                                defaultValue=""
                              >
                                <option value="" disabled>+ Agregar producto</option>
                                {productos
                                  .filter(p => !(activity.productos || []).find(ap => ap.productoId === p.id))
                                  .map(p => <option key={p.id} value={p.id}>{p.nombreComercial}</option>)
                                }
                              </select>
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
            {isEditing && <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>}
          </div>
        </form>
      </div>

      <div className="list-card">
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
                <button onClick={() => handleEdit(pkg)} className="icon-btn" title="Editar">
                  <FiEdit size={18} />
                </button>
                <button onClick={() => handleDelete(pkg.id)} className="icon-btn delete" title="Eliminar">
                  <FiTrash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {packages.length === 0 && <p className="empty-state">No hay paquetes creados.</p>}
      </div>
    </div>
  );
}

export default PackageManagement;
