import { useState, useEffect, useRef, Fragment } from 'react';
import '../../../pages/PackageManagement.css';
import {
  FiEdit2, FiTrash2, FiPlus, FiX, FiEye, FiCopy,
  FiChevronRight, FiArrowLeft, FiCheck, FiClipboard,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';

const MAX_NOMBRE_PAQUETE = 40;
const MAX_DESCRIPCION = 500;
const MAX_TECNICO = 80;
const MAX_ACTIVITY_NAME = 80;
const MAX_DAY = 9999;

const EMPTY_ACTIVITY = { day: '', name: '', responsableId: '', formularios: [] };
const makeEmptyForm = () => ({ id: null, nombrePaquete: '', descripcion: '', tecnicoResponsable: '', activities: [] });
const makeNewForm = () => ({ ...makeEmptyForm(), activities: [{ ...EMPTY_ACTIVITY }] });

const normalizeActivities = (activities) => (activities || [])
  .map(a => ({ formularios: [], ...a }))
  .sort((a, b) => Number(a.day) - Number(b.day));

function ActivitiesEditor({
  activities, users, plantillas, onChange, autoExpandFirst = false,
}) {
  const [expanded, setExpanded] = useState(() => autoExpandFirst ? new Set([0]) : new Set());
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState(null);

  const update = (i, field, value) => {
    const next = [...activities];
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };

  const addActivity = () => {
    const newIdx = activities.length;
    onChange([...activities, { ...EMPTY_ACTIVITY }]);
    setExpanded(prev => new Set(prev).add(newIdx));
  };

  const duplicateActivity = (i) => {
    const copy = JSON.parse(JSON.stringify(activities[i]));
    if (copy.name) copy.name = `Copia de ${copy.name}`;
    onChange([...activities.slice(0, i + 1), copy, ...activities.slice(i + 1)]);
    setExpanded(prev => {
      const next = new Set();
      prev.forEach(idx => { if (idx <= i) next.add(idx); else next.add(idx + 1); });
      return next;
    });
  };

  const removeActivity = (i) => {
    onChange(activities.filter((_, idx) => idx !== i));
    setPendingDeleteIdx(null);
    setExpanded(prev => {
      const next = new Set();
      prev.forEach(idx => { if (idx < i) next.add(idx); else if (idx > i) next.add(idx - 1); });
      return next;
    });
  };

  const toggleExpand = (i) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const addPlantilla = (i, plantillaId) => {
    if (!plantillaId) return;
    const plantilla = plantillas.find(t => t.id === plantillaId);
    if (!plantilla) return;
    const existing = activities[i].formularios || [];
    if (existing.find(f => f.tipoId === plantillaId)) return;
    update(i, 'formularios', [...existing, { tipoId: plantilla.id, tipoNombre: plantilla.nombre }]);
  };

  const removePlantilla = (i, plantillaId) => {
    update(i, 'formularios', (activities[i].formularios || []).filter(f => f.tipoId !== plantillaId));
  };

  return (
    <>
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
            {activities.map((activity, index) => (
              <Fragment key={index}>
                <tr>
                  <td>
                    <input
                      value={activity.day}
                      onChange={(e) => update(index, 'day', e.target.value)}
                      type="number"
                      min={0}
                      max={MAX_DAY}
                      step={1}
                      required
                    />
                  </td>
                  <td>
                    <input
                      value={activity.name}
                      onChange={(e) => update(index, 'name', e.target.value)}
                      placeholder="Nombre de la actividad"
                      maxLength={MAX_ACTIVITY_NAME}
                      required
                    />
                  </td>
                  <td>
                    <select
                      value={activity.responsableId}
                      onChange={(e) => update(index, 'responsableId', e.target.value)}
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
                          <button type="button" onClick={() => setPendingDeleteIdx(index)} className="icon-btn pkg-action-btn" title="Eliminar Actividad">
                            <FiX size={16} />
                          </button>
                          <button type="button" onClick={() => duplicateActivity(index)} className="icon-btn pkg-action-btn" title="Duplicar Actividad">
                            <FiCopy size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleExpand(index)}
                            className={`icon-btn pkg-action-btn${expanded.has(index) ? ' expanded' : ''}`}
                            title={expanded.has(index) ? 'Ocultar formularios' : 'Ver formularios'}
                          >
                            <FiEye size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {expanded.has(index) && (
                  <tr className="products-subrow-tr">
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
                                onClick={() => removePlantilla(index, f.tipoId)}
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
                              onChange={(e) => { if (e.target.value) addPlantilla(index, e.target.value); }}
                            >
                              <option value="">+ Agregar plantilla...</option>
                              {plantillas
                                .filter(t => !(activity.formularios || []).find(f => f.tipoId === t.id))
                                .map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)
                              }
                            </select>
                          )}
                        </div>

                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="add-activity-btn-container">
        <button type="button" onClick={addActivity} className="btn btn-secondary">
          <FiPlus /> Añadir Actividad
        </button>
      </div>
    </>
  );
}

function PackagePreview({ pkg, users }) {
  const activities = normalizeActivities(pkg.activities);
  const userNameById = (id) => users.find(u => u.id === id)?.nombre || '—';

  return (
    <div className="tipo-campos-preview" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      {pkg.descripcion && (
        <>
          <span className="campos-section-divider" style={{ width: '100%' }}>Descripción</span>
          <p style={{ margin: '0 0 0.5rem', color: 'var(--aurora-light)', fontSize: '0.88rem' }}>{pkg.descripcion}</p>
        </>
      )}

      {pkg.tecnicoResponsable && (
        <>
          <span className="campos-section-divider" style={{ width: '100%' }}>Técnico responsable</span>
          <p style={{ margin: '0 0 0.5rem', color: 'var(--aurora-light)', fontSize: '0.88rem' }}>{pkg.tecnicoResponsable}</p>
        </>
      )}

      <span className="campos-section-divider" style={{ width: '100%' }}>Actividades ({activities.length})</span>
      {activities.length === 0 ? (
        <span className="label-optional">Sin actividades</span>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {activities.map((a, i) => (
            <li key={i} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: 'var(--aurora-light)' }}>Día {a.day} · {a.name}</span>
                <span className="label-optional">{userNameById(a.responsableId)}</span>
              </div>
              {(a.formularios || []).length > 0 && (
                <div className="products-tags" style={{ marginTop: 6 }}>
                  {a.formularios.map(f => (
                    <span key={f.tipoId} className="campo-chip">{f.tipoNombre}</span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SamplingPackages() {
  const apiFetch = useApiFetch();
  const [packages, setPackages]       = useState([]);
  const [users, setUsers]             = useState([]);
  const [plantillas, setPlantillas]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [isEditing, setIsEditing]     = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [formData, setFormData]       = useState(makeEmptyForm);
  const [pendingDeletePkgId, setPendingDeletePkgId] = useState(null);
  const [toast, setToast]             = useState(null);
  const carouselRef = useRef(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    if (!selectedPkg || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedPkg]);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/monitoreo/paquetes').then(r => r.json()),
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/monitoreo/tipos').then(r => r.json()),
    ])
      .then(([pkgs, usrs, tipos]) => {
        setPackages(pkgs);
        setUsers(usrs);
        setPlantillas(tipos.filter(t => t.activo));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSelectPkg = (pkg) => {
    setSelectedPkg(pkg);
    setIsEditing(false);
    setShowNew(false);
  };

  const startEdit = () => {
    setFormData({ ...selectedPkg, activities: normalizeActivities(selectedPkg.activities) });
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setFormData(makeEmptyForm());
  };

  const startNew = () => {
    setSelectedPkg(null);
    setIsEditing(false);
    setShowNew(true);
    setFormData(makeNewForm());
  };

  const cancelNew = () => {
    setShowNew(false);
    setFormData(makeEmptyForm());
  };

  const saveForm = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    const nombre = (formData.nombrePaquete || '').trim();
    if (!nombre) { showToast('El nombre del paquete es obligatorio.', 'error'); return; }
    if (nombre.length > MAX_NOMBRE_PAQUETE) { showToast(`Nombre excede ${MAX_NOMBRE_PAQUETE} caracteres.`, 'error'); return; }
    if ((formData.descripcion || '').length > MAX_DESCRIPCION) { showToast(`Descripción excede ${MAX_DESCRIPCION} caracteres.`, 'error'); return; }
    if ((formData.tecnicoResponsable || '').length > MAX_TECNICO) { showToast(`Técnico responsable excede ${MAX_TECNICO} caracteres.`, 'error'); return; }

    for (const a of formData.activities) {
      const dayNum = Number(a.day);
      if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > MAX_DAY) {
        showToast('Cada actividad requiere un día entero entre 0 y 9999.', 'error');
        return;
      }
      if (!a.name || !a.name.trim()) {
        showToast('Toda actividad debe tener nombre.', 'error');
        return;
      }
    }

    const url = isEditing ? `/api/monitoreo/paquetes/${formData.id}` : '/api/monitoreo/paquetes';
    const method = isEditing ? 'PUT' : 'POST';
    const sortedActivities = [...formData.activities].sort((a, b) => Number(a.day) - Number(b.day));
    const body = { ...formData, nombrePaquete: nombre, activities: sortedActivities };
    try {
      const response = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Error al guardar el paquete');
      const updated = await apiFetch('/api/monitoreo/paquetes').then(r => r.json());
      setPackages(updated);
      if (isEditing) {
        const saved = updated.find(p => p.id === formData.id);
        if (saved) setSelectedPkg(saved);
        setIsEditing(false);
      } else {
        setShowNew(false);
      }
      setFormData(makeEmptyForm());
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
      setPackages(prev => prev.filter(p => p.id !== id));
      setPendingDeletePkgId(null);
      if (selectedPkg?.id === id) { setSelectedPkg(null); setIsEditing(false); }
      showToast('Paquete eliminado correctamente');
    } catch {
      showToast('Error al eliminar el paquete.', 'error');
    }
  };

  const updateFormField = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));
  const updateActivities = (activities) => setFormData(prev => ({ ...prev, activities }));

  return (
    <div className={`lote-page${selectedPkg ? ' lote-page--selected' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {loading ? (
        <div className="mon-loading" />
      ) : packages.length === 0 && !showNew ? (
        <div className="mon-empty-state">
          <FiClipboard size={36} />
          <p>No hay paquetes de muestreo creados</p>
          <button className="btn btn-primary" onClick={startNew}>
            <FiPlus size={14} /> Crear el primero
          </button>
        </div>
      ) : (
        <>
          {!selectedPkg && !showNew && (
            <div className="lote-page-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="lote-list-title">Paquetes de muestreo</h3>
              <button className="btn btn-primary" onClick={startNew}>
                <FiPlus size={16} /> Nuevo paquete
              </button>
            </div>
          )}

          {selectedPkg && (
            <div className="lote-carousel" ref={carouselRef}>
              {packages.map(pkg => (
                <button
                  key={pkg.id}
                  className={`lote-bubble${selectedPkg?.id === pkg.id ? ' lote-bubble--active' : ''}`}
                  onClick={() => selectedPkg?.id === pkg.id ? setSelectedPkg(null) : handleSelectPkg(pkg)}
                >
                  <span className="lote-bubble-avatar">{pkg.nombrePaquete.slice(0, 4)}</span>
                  <span className="lote-bubble-label">{pkg.nombrePaquete}</span>
                </button>
              ))}
              <button className="lote-bubble lote-bubble--add" onClick={startNew}>
                <span className="lote-bubble-avatar lote-bubble-avatar--add">+</span>
                <span className="lote-bubble-label">Nuevo</span>
              </button>
            </div>
          )}

          <div className="lote-management-layout">
            {selectedPkg ? (
              <div className="lote-hub">
                <button className="lote-hub-back" onClick={() => { setSelectedPkg(null); setIsEditing(false); }}>
                  <FiArrowLeft size={13} /> Todos los paquetes
                </button>

                <div className="hub-header">
                  <div className="hub-title-block">
                    {isEditing ? (
                      <input
                        className="tipo-nombre-input"
                        value={formData.nombrePaquete}
                        onChange={e => updateFormField('nombrePaquete', e.target.value)}
                        maxLength={MAX_NOMBRE_PAQUETE}
                      />
                    ) : (
                      <h2 className="hub-lote-code">{selectedPkg.nombrePaquete}</h2>
                    )}
                  </div>
                  <div className="hub-header-actions">
                    {isEditing ? (
                      <>
                        <button className="icon-btn" style={{ color: 'var(--aurora-green)', opacity: 1 }} onClick={saveForm} title="Guardar"><FiCheck size={16} /></button>
                        <button className="icon-btn" onClick={cancelEdit} title="Cancelar"><FiX size={16} /></button>
                      </>
                    ) : (
                      <>
                        <button className="icon-btn" onClick={startEdit} title="Editar"><FiEdit2 size={15} /></button>
                        <button className="icon-btn" onClick={() => handleDuplicate(selectedPkg)} title="Duplicar"><FiCopy size={15} /></button>
                        {pendingDeletePkgId === selectedPkg.id ? (
                          <div className="activity-delete-confirm">
                            <span>¿Eliminar?</span>
                            <button className="btn-confirm-yes" onClick={() => handleDelete(selectedPkg.id)}>Sí</button>
                            <button className="btn-confirm-no" onClick={() => setPendingDeletePkgId(null)}>No</button>
                          </div>
                        ) : (
                          <button className="icon-btn delete" onClick={() => setPendingDeletePkgId(selectedPkg.id)} title="Eliminar"><FiTrash2 size={15} /></button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <form onSubmit={saveForm} className="lote-form" style={{ padding: '0.5rem 1rem 0.75rem' }}>
                    <div className="form-grid">
                      <div className="form-control">
                        <label htmlFor="tecnicoResponsable">Técnico responsable</label>
                        <input
                          id="tecnicoResponsable"
                          value={formData.tecnicoResponsable}
                          onChange={e => updateFormField('tecnicoResponsable', e.target.value)}
                          placeholder="Nombre del técnico responsable"
                          maxLength={MAX_TECNICO}
                        />
                      </div>
                      <div className="form-control form-control--full">
                        <label htmlFor="descripcion">Descripción</label>
                        <textarea
                          id="descripcion"
                          value={formData.descripcion}
                          onChange={e => updateFormField('descripcion', e.target.value)}
                          placeholder="Ej: Paquete de muestreo fitosanitario para etapa de desarrollo."
                          maxLength={MAX_DESCRIPCION}
                          rows={3}
                        />
                      </div>
                    </div>

                    <ActivitiesEditor
                      activities={formData.activities}
                      users={users}
                      plantillas={plantillas}
                      onChange={updateActivities}
                    />
                  </form>
                ) : (
                  <PackagePreview pkg={selectedPkg} users={users} />
                )}
              </div>
            ) : showNew ? (
              <div className="form-card">
                <p className="form-section-title">Nuevo Paquete de Muestreos</p>
                <form onSubmit={saveForm} className="lote-form">
                  <div className="form-grid">
                    <div className="form-control">
                      <label htmlFor="nombrePaquete">Nombre del paquete</label>
                      <input
                        id="nombrePaquete"
                        value={formData.nombrePaquete}
                        onChange={e => updateFormField('nombrePaquete', e.target.value)}
                        maxLength={MAX_NOMBRE_PAQUETE}
                        required
                      />
                    </div>
                    <div className="form-control">
                      <label htmlFor="tecnicoResponsable">Técnico responsable</label>
                      <input
                        id="tecnicoResponsable"
                        value={formData.tecnicoResponsable}
                        onChange={e => updateFormField('tecnicoResponsable', e.target.value)}
                        placeholder="Nombre del técnico responsable"
                        maxLength={MAX_TECNICO}
                      />
                    </div>
                    <div className="form-control form-control--full">
                      <label htmlFor="descripcion">Descripción</label>
                      <textarea
                        id="descripcion"
                        value={formData.descripcion}
                        onChange={e => updateFormField('descripcion', e.target.value)}
                        placeholder="Ej: Paquete de muestreo fitosanitario para etapa de desarrollo."
                        maxLength={MAX_DESCRIPCION}
                        rows={3}
                      />
                    </div>
                  </div>

                  <ActivitiesEditor
                    activities={formData.activities}
                    users={users}
                    plantillas={plantillas}
                    onChange={updateActivities}
                    autoExpandFirst
                  />

                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">Crear paquete</button>
                    <button type="button" className="btn btn-secondary" onClick={cancelNew}>Cancelar</button>
                  </div>
                </form>
              </div>
            ) : null}

            {!showNew && (
              <div className="lote-list-panel">
                <ul className="lote-list">
                  {packages.map(pkg => (
                    <li
                      key={pkg.id}
                      className={`lote-list-item${selectedPkg?.id === pkg.id ? ' active' : ''}`}
                      onClick={() => selectedPkg?.id === pkg.id ? setSelectedPkg(null) : handleSelectPkg(pkg)}
                    >
                      <div className="lote-list-info">
                        <span className="lote-list-code">{pkg.nombrePaquete}</span>
                        <span className="lote-list-name">
                          {pkg.activities?.length || 0} actividades
                          {pkg.tecnicoResponsable ? ` · ${pkg.tecnicoResponsable}` : ''}
                        </span>
                      </div>
                      <FiChevronRight size={14} className="lote-list-arrow" />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default SamplingPackages;
