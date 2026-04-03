import { useState, useEffect } from 'react';
import './PackageManagement.css';
import { FiEdit, FiTrash2, FiPlus, FiX, FiEye, FiCopy, FiPaperclip, FiFile } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

function MonitoreoPackages() {
  const apiFetch = useApiFetch();
  const [packages, setPackages] = useState([]);
  const [users, setUsers] = useState([]);
  const [plantillas, setPlantillas] = useState([]);
  const [formData, setFormData] = useState({
    id: null,
    nombrePaquete: '',
    descripcion: '',
    tecnicoResponsable: '',
    activities: [],
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [expandedActivities, setExpandedActivities] = useState(new Set());
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const [pendingDeleteIdx, setPendingDeleteIdx] = useState(null);
  const [pendingDeletePkgId, setPendingDeletePkgId] = useState(null);
  const [uploadingIdx, setUploadingIdx] = useState(null);

  useEffect(() => {
    apiFetch('/api/monitoreo/paquetes').then(r => r.json()).then(setPackages).catch(console.error);
    apiFetch('/api/users').then(r => r.json()).then(setUsers).catch(console.error);
    apiFetch('/api/monitoreo/tipos').then(r => r.json()).then(data => setPlantillas(data.filter(t => t.activo))).catch(console.error);
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleActivityChange = (index, field, value) => {
    const updated = [...formData.activities];
    updated[index] = { ...updated[index], [field]: value };
    setFormData(prev => ({ ...prev, activities: updated }));
  };

  const addActivity = () => {
    setFormData(prev => ({
      ...prev,
      activities: [...prev.activities, { day: '', name: '', responsableId: '', formularios: [], archivoExcel: null }],
    }));
  };

  const duplicateActivity = (index) => {
    const copy = JSON.parse(JSON.stringify(formData.activities[index]));
    if (copy.name) copy.name = `Copia de ${copy.name}`;
    const updated = [
      ...formData.activities.slice(0, index + 1),
      copy,
      ...formData.activities.slice(index + 1),
    ];
    setFormData(prev => ({ ...prev, activities: updated }));
  };

  const handleExcelUpload = async (activityIndex, file) => {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      showToast('Solo se permiten archivos Excel (.xlsx, .xls, .csv)', 'error');
      return;
    }
    setUploadingIdx(activityIndex);
    try {
      const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `formularios-muestreo/${Date.now()}_${sanitized}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      const updated = [...formData.activities];
      updated[activityIndex] = { ...updated[activityIndex], archivoExcel: { nombre: file.name, url, storagePath: path } };
      setFormData(prev => ({ ...prev, activities: updated }));
    } catch {
      showToast('Error al subir el archivo.', 'error');
    } finally {
      setUploadingIdx(null);
    }
  };

  const removeExcelFromActivity = async (activityIndex) => {
    const activity = formData.activities[activityIndex];
    if (activity.archivoExcel?.storagePath) {
      try {
        await deleteObject(ref(storage, activity.archivoExcel.storagePath));
      } catch {
        // archivo ya no existe, continuar
      }
    }
    const updated = [...formData.activities];
    updated[activityIndex] = { ...updated[activityIndex], archivoExcel: null };
    setFormData(prev => ({ ...prev, activities: updated }));
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
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const addPlantillaToActivity = (activityIndex, plantillaId) => {
    if (!plantillaId) return;
    const plantilla = plantillas.find(t => t.id === plantillaId);
    if (!plantilla) return;
    const updated = [...formData.activities];
    const existing = updated[activityIndex].formularios || [];
    if (existing.find(f => f.tipoId === plantillaId)) return;
    updated[activityIndex] = {
      ...updated[activityIndex],
      formularios: [...existing, { tipoId: plantilla.id, tipoNombre: plantilla.nombre }],
    };
    setFormData(prev => ({ ...prev, activities: updated }));
  };

  const removePlantillaFromActivity = (activityIndex, plantillaId) => {
    const updated = [...formData.activities];
    updated[activityIndex] = {
      ...updated[activityIndex],
      formularios: updated[activityIndex].formularios.filter(f => f.tipoId !== plantillaId),
    };
    setFormData(prev => ({ ...prev, activities: updated }));
  };

  const handleEdit = (pkg) => {
    const normalizedActivities = (pkg.activities || [])
      .map(a => ({ formularios: [], ...a }))
      .sort((a, b) => Number(a.day) - Number(b.day));
    setFormData({ ...pkg, activities: normalizedActivities });
    setIsEditing(true);
    setIsFormOpen(true);
    setExpandedActivities(new Set());
    window.scrollTo(0, 0);
  };

  const resetForm = () => {
    setFormData({ id: null, nombrePaquete: '', descripcion: '', tecnicoResponsable: '', activities: [] });
    setIsEditing(false);
    setIsFormOpen(false);
    setExpandedActivities(new Set());
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/monitoreo/paquetes/${formData.id}` : '/api/monitoreo/paquetes';
    const method = isEditing ? 'PUT' : 'POST';
    const sortedActivities = [...formData.activities].sort((a, b) => Number(a.day) - Number(b.day));
    const body = { ...formData, activities: sortedActivities };
    try {
      const response = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Error al guardar el paquete');
      const updated = await apiFetch('/api/monitoreo/paquetes').then(r => r.json());
      setPackages(updated);
      resetForm();
      showToast(isEditing ? 'Paquete actualizado correctamente' : 'Paquete guardado correctamente');
    } catch {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };

  const handleDuplicate = async (pkg) => {
    const body = {
      nombrePaquete: `Copia de ${pkg.nombrePaquete}`,
      descripcion: pkg.descripcion || '',
      tecnicoResponsable: pkg.tecnicoResponsable || '',
      activities: pkg.activities || [],
    };
    try {
      const response = await apiFetch('/api/monitoreo/paquetes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      const updated = await apiFetch('/api/monitoreo/paquetes').then(r => r.json());
      setPackages(updated);
      showToast(`Paquete duplicado: "${body.nombrePaquete}"`);
    } catch {
      showToast('Error al duplicar el paquete.', 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      const response = await apiFetch(`/api/monitoreo/paquetes/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error();
      setPackages(packages.filter(p => p.id !== id));
      setPendingDeletePkgId(null);
      showToast('Paquete eliminado correctamente');
    } catch {
      showToast('Error al eliminar el paquete.', 'error');
    }
  };

  return (
    <div className="pkg-page-wrapper">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="pkg-page-header">
        <h1 className="pkg-page-title">Paquetes de Muestreos</h1>
        {!isFormOpen && packages.length > 0 && (
          <button className="btn btn-primary" onClick={() => setIsFormOpen(true)}>
            <FiPlus /> Nuevo Paquete
          </button>
        )}
      </div>

      <div className="lote-management-layout">
        <div className="form-card">
          {isFormOpen ? (
            <>
              <h2>{isEditing ? 'Editando Paquete' : 'Nuevo Paquete de Muestreos'}</h2>
              <form onSubmit={handleSubmit} className="lote-form">
                <div className="form-grid">
                  <div className="form-control">
                    <label htmlFor="nombrePaquete">Nombre del Paquete</label>
                    <input
                      id="nombrePaquete"
                      name="nombrePaquete"
                      value={formData.nombrePaquete}
                      onChange={handleInputChange}
                      maxLength={40}
                      required
                    />
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
                  <div className="form-control form-control--full">
                    <label htmlFor="descripcion">Descripción</label>
                    <textarea
                      id="descripcion"
                      name="descripcion"
                      value={formData.descripcion}
                      onChange={handleInputChange}
                      placeholder="Ej: Paquete de muestreo fitosanitario para etapa de desarrollo."
                      rows={3}
                    />
                  </div>
                </div>

                <h3>Actividades de Muestreo</h3>
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
                          <tr key={`row-${index}`}>
                            <td>
                              <input
                                value={activity.day}
                                onChange={(e) => handleActivityChange(index, 'day', e.target.value)}
                                type="number"
                                required
                              />
                            </td>
                            <td>
                              <input
                                value={activity.name}
                                onChange={(e) => handleActivityChange(index, 'name', e.target.value)}
                                placeholder="Nombre de la actividad"
                                required
                              />
                            </td>
                            <td>
                              <select
                                value={activity.responsableId}
                                onChange={(e) => handleActivityChange(index, 'responsableId', e.target.value)}
                              >
                                <option value="">-- Asignar --</option>
                                {users.map(user => (
                                  <option key={user.id} value={user.id}>{user.nombre}</option>
                                ))}
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
                                    <button
                                      type="button"
                                      onClick={() => setPendingDeleteIdx(index)}
                                      className="icon-btn pkg-action-btn"
                                      title="Eliminar Actividad"
                                    >
                                      <FiX size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => duplicateActivity(index)}
                                      className="icon-btn pkg-action-btn"
                                      title="Duplicar Actividad"
                                    >
                                      <FiCopy size={15} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => toggleActivityExpand(index)}
                                      className={`icon-btn pkg-action-btn${expandedActivities.has(index) ? ' expanded' : ''}`}
                                      title={expandedActivities.has(index) ? 'Ocultar formularios' : 'Ver formularios'}
                                    >
                                      <FiEye size={16} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expandedActivities.has(index) && (
                            <tr key={`formularios-${index}`} className="products-subrow-tr">
                              <td colSpan="4">
                                <div className="products-subrow">
                                  <div className="products-subrow-header">
                                    <span className="products-subrow-label">Plantillas de muestreo:</span>
                                  </div>
                                  <div className="products-tags">
                                    {(activity.formularios || []).map(f => (
                                      <span key={f.tipoId} className="product-tag">
                                        <strong>{f.tipoNombre}</strong>
                                        <button
                                          type="button"
                                          className="product-tag-remove"
                                          onClick={() => removePlantillaFromActivity(index, f.tipoId)}
                                          title="Quitar plantilla"
                                        >
                                          <FiX size={12} />
                                        </button>
                                      </span>
                                    ))}
                                    {plantillas.filter(t => !(activity.formularios || []).find(f => f.tipoId === t.id)).length > 0 && (
                                      <select
                                        className="add-product-select"
                                        value=""
                                        onChange={(e) => { if (e.target.value) addPlantillaToActivity(index, e.target.value); }}
                                      >
                                        <option value="">+ Agregar plantilla...</option>
                                        {plantillas
                                          .filter(t => !(activity.formularios || []).find(f => f.tipoId === t.id))
                                          .map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)
                                        }
                                      </select>
                                    )}
                                  </div>

                                  <div className="products-subrow-header">
                                    <span className="products-subrow-label">Adjuntar formulario:</span>
                                  </div>
                                  {activity.archivoExcel ? (
                                    <div className="excel-file-row">
                                      <FiFile size={14} className="excel-file-icon" />
                                      <a href={activity.archivoExcel.url} className="excel-file-name" target="_blank" rel="noreferrer">
                                        {activity.archivoExcel.nombre}
                                      </a>
                                      <button
                                        type="button"
                                        className="product-tag-remove"
                                        onClick={() => removeExcelFromActivity(index)}
                                        title="Quitar archivo"
                                      >
                                        <FiX size={13} />
                                      </button>
                                    </div>
                                  ) : (
                                    <label className={`excel-upload-btn${uploadingIdx === index ? ' excel-upload-btn--loading' : ''}`}>
                                      <FiPaperclip size={13} />
                                      {uploadingIdx === index ? 'Subiendo...' : 'Adjuntar Excel'}
                                      <input
                                        type="file"
                                        accept=".xlsx,.xls,.csv"
                                        style={{ display: 'none' }}
                                        disabled={uploadingIdx === index}
                                        onChange={e => { if (e.target.files[0]) handleExcelUpload(index, e.target.files[0]); e.target.value = ''; }}
                                      />
                                    </label>
                                  )}
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
                    <FiPlus /> Añadir Actividad
                  </button>
                </div>

                <div className="form-actions">
                  <button type="submit" className="btn btn-primary">
                    {isEditing ? 'Actualizar Paquete' : 'Guardar Paquete'}
                  </button>
                  <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>
                </div>
              </form>
            </>
          ) : packages.length === 0 ? (
            <div className="pkg-form-placeholder">
              <p>¡Aún no hay ningún paquete creado!<br />Empieza creando el primero.</p>
              <button className="btn btn-primary" onClick={() => setIsFormOpen(true)}>
                <FiPlus /> Nuevo Paquete
              </button>
            </div>
          ) : (
            <div className="pkg-form-placeholder">
              <p>Selecciona un paquete de la lista para editarlo,<br />o crea uno nuevo con el botón de arriba.</p>
            </div>
          )}
        </div>

        <div className="list-card">
          <h2>Paquetes Existentes</h2>
          <ul className="info-list">
            {packages.map(pkg => (
              <li key={pkg.id}>
                <div>
                  <div className="item-main-text">{pkg.nombrePaquete}</div>
                  <div className="package-sub-info">
                    <span>{pkg.activities?.length || 0} actividades</span>
                    {pkg.tecnicoResponsable && <> | <span>{pkg.tecnicoResponsable}</span></>}
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
                      <button onClick={() => setPendingDeletePkgId(pkg.id)} className="icon-btn delete" title="Eliminar">
                        <FiTrash2 size={18} />
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {packages.length === 0 && <p className="empty-state">No hay paquetes creados.</p>}
        </div>
      </div>
    </div>
  );
}

export default MonitoreoPackages;
