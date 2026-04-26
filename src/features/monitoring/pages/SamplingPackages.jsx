import { useState, useEffect, useRef } from 'react';
import '../../applications/styles/packages.css';
import {
  FiEdit2, FiTrash2, FiPlus, FiX, FiCopy,
  FiChevronRight, FiChevronDown, FiArrowLeft, FiCheck, FiClipboard,
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
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num">⊞</span>
        <h3>Actividades de muestreo</h3>
        <span className="aur-section-count">{activities.length}</span>
      </div>
      <ul className="pkg-act-list">
        {activities.map((activity, index) => {
          const expandedNow = expanded.has(index);
          const availablePlantillas = plantillas.filter(
            t => !(activity.formularios || []).find(f => f.tipoId === t.id)
          );
          return (
            <li key={index} className="pkg-act-card">
              <div className="pkg-act-row">
                <div className="pkg-act-day">
                  <input
                    type="number"
                    min={0}
                    max={MAX_DAY}
                    step={1}
                    value={activity.day}
                    onChange={(e) => update(index, 'day', e.target.value)}
                    aria-label="Día"
                    required
                  />
                  <span className="pkg-act-day-suffix">día</span>
                </div>

                <div className="pkg-act-body">
                  <input
                    type="text"
                    className="pkg-act-name"
                    value={activity.name}
                    onChange={(e) => update(index, 'name', e.target.value)}
                    placeholder="Nombre de la actividad"
                    maxLength={MAX_ACTIVITY_NAME}
                    aria-label="Nombre de la actividad"
                    required
                  />
                  <div className="pkg-act-meta">
                    <select
                      className="aur-chip"
                      value={activity.responsableId}
                      onChange={(e) => update(index, 'responsableId', e.target.value)}
                      aria-label="Responsable"
                    >
                      <option value="">Responsable</option>
                      {users.map(user => (
                        <option key={user.id} value={user.id}>{user.nombre}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pkg-act-actions">
                  {pendingDeleteIdx === index ? (
                    <div className="aur-inline-confirm">
                      <span className="aur-inline-confirm-text">¿Eliminar?</span>
                      <button type="button" className="aur-inline-confirm-yes" onClick={() => removeActivity(index)}>Sí</button>
                      <button type="button" className="aur-inline-confirm-no" onClick={() => setPendingDeleteIdx(null)}>No</button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="aur-icon-btn"
                        onClick={() => duplicateActivity(index)}
                        title="Duplicar actividad"
                      >
                        <FiCopy size={14} />
                      </button>
                      <button
                        type="button"
                        className="aur-icon-btn aur-icon-btn--danger"
                        onClick={() => setPendingDeleteIdx(index)}
                        title="Eliminar actividad"
                      >
                        <FiX size={15} />
                      </button>
                      <button
                        type="button"
                        className={`aur-icon-btn pkg-act-expand${expandedNow ? ' is-open' : ''}`}
                        onClick={() => toggleExpand(index)}
                        title={expandedNow ? 'Ocultar plantillas' : 'Plantillas de muestreo'}
                      >
                        <FiChevronDown size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {expandedNow && (
                <div className="pkg-act-products">
                  <span className="pkg-act-products-label">Plantillas de muestreo</span>
                  <div className="pkg-act-products-list">
                    {(activity.formularios || []).map(f => (
                      <div key={f.tipoId} className="pkg-prod-row">
                        <span className="pkg-prod-row-name">{f.tipoNombre}</span>
                        <span aria-hidden="true" />
                        <span aria-hidden="true" />
                        <button
                          type="button"
                          className="pkg-prod-row-remove"
                          onClick={() => removePlantilla(index, f.tipoId)}
                          title="Quitar plantilla"
                        >
                          <FiX size={13} />
                        </button>
                      </div>
                    ))}
                    {availablePlantillas.length > 0 && (
                      <select
                        className="aur-chip aur-chip--ghost"
                        value=""
                        onChange={(e) => { if (e.target.value) addPlantilla(index, e.target.value); }}
                        aria-label="Agregar plantilla"
                        style={{ alignSelf: 'flex-start', marginTop: 6 }}
                      >
                        <option value="">+ Agregar plantilla</option>
                        {availablePlantillas.map(t => (
                          <option key={t.id} value={t.id}>{t.nombre}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <button type="button" onClick={addActivity} className="pkg-add-activity">
        <FiPlus size={14} /> Añadir actividad
      </button>
    </section>
  );
}

function PackagePreview({ pkg, users }) {
  const activities = normalizeActivities(pkg.activities);
  const userNameById = (id) => users.find(u => u.id === id)?.nombre || '—';

  return (
    <div className="spk-preview">
      {(pkg.descripcion || pkg.tecnicoResponsable) && (
        <section className="aur-section">
          <div className="aur-list">
            {pkg.descripcion && (
              <div className="aur-row aur-row--multiline">
                <span className="aur-row-label">Descripción</span>
                <span className="spk-preview-text">{pkg.descripcion}</span>
              </div>
            )}
            {pkg.tecnicoResponsable && (
              <div className="aur-row">
                <span className="aur-row-label">Técnico responsable</span>
                <span className="spk-preview-text">{pkg.tecnicoResponsable}</span>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num">⊞</span>
          <h3>Actividades</h3>
          <span className="aur-section-count">{activities.length}</span>
        </div>
        {activities.length === 0 ? (
          <div className="spk-preview-empty">Sin actividades</div>
        ) : (
          <ul className="spk-preview-acts">
            {activities.map((a, i) => (
              <li key={i} className="spk-preview-act">
                <div className="spk-preview-act-row">
                  <span className="spk-preview-act-name">
                    <span className="spk-preview-act-day">Día {a.day}</span>
                    {a.name}
                  </span>
                  <span className="spk-preview-act-user">{userNameById(a.responsableId)}</span>
                </div>
                {(a.formularios || []).length > 0 && (
                  <div className="spk-preview-act-chips">
                    {a.formularios.map(f => (
                      <span key={f.tipoId} className="aur-badge aur-badge--magenta">
                        {f.tipoNombre}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
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
          <button className="aur-btn-pill" onClick={startNew}>
            <FiPlus size={14} /> Crear el primero
          </button>
        </div>
      ) : (
        <>
          {!selectedPkg && !showNew && (
            <div className="lote-page-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="lote-list-title">Paquetes de muestreo</h3>
              <button className="aur-btn-pill" onClick={startNew}>
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
                        <button className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--success" onClick={saveForm} title="Guardar"><FiCheck size={16} /></button>
                        <button className="aur-icon-btn aur-icon-btn--sm" onClick={cancelEdit} title="Cancelar"><FiX size={16} /></button>
                      </>
                    ) : (
                      <>
                        <button className="aur-icon-btn aur-icon-btn--sm" onClick={startEdit} title="Editar"><FiEdit2 size={15} /></button>
                        <button className="aur-icon-btn aur-icon-btn--sm" onClick={() => handleDuplicate(selectedPkg)} title="Duplicar"><FiCopy size={15} /></button>
                        {pendingDeletePkgId === selectedPkg.id ? (
                          <div className="activity-delete-confirm">
                            <span>¿Eliminar?</span>
                            <button className="btn-confirm-yes" onClick={() => handleDelete(selectedPkg.id)}>Sí</button>
                            <button className="btn-confirm-no" onClick={() => setPendingDeletePkgId(null)}>No</button>
                          </div>
                        ) : (
                          <button className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger" onClick={() => setPendingDeletePkgId(selectedPkg.id)} title="Eliminar"><FiTrash2 size={15} /></button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <form onSubmit={saveForm} className="spk-form spk-form--edit">
                    <section className="aur-section">
                      <div className="aur-list">
                        <div className="aur-row">
                          <label className="aur-row-label" htmlFor="tecnicoResponsable">Técnico responsable</label>
                          <input
                            id="tecnicoResponsable"
                            className="aur-input"
                            value={formData.tecnicoResponsable}
                            onChange={e => updateFormField('tecnicoResponsable', e.target.value)}
                            placeholder="Nombre del técnico responsable"
                            maxLength={MAX_TECNICO}
                          />
                        </div>
                        <div className="aur-row aur-row--multiline">
                          <label className="aur-row-label" htmlFor="descripcion">Descripción</label>
                          <textarea
                            id="descripcion"
                            className="aur-textarea"
                            value={formData.descripcion}
                            onChange={e => updateFormField('descripcion', e.target.value)}
                            placeholder="Ej: Paquete de muestreo fitosanitario para etapa de desarrollo."
                            maxLength={MAX_DESCRIPCION}
                            rows={3}
                          />
                        </div>
                      </div>
                    </section>

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
              <div className="aur-sheet">
                <form onSubmit={saveForm} className="spk-form spk-form--new">
                  <section className="aur-section">
                    <div className="aur-section-header">
                      <span className="aur-section-num">+</span>
                      <h3>Nuevo paquete de muestreos</h3>
                    </div>
                    <div className="aur-list">
                      <div className="aur-row">
                        <label className="aur-row-label" htmlFor="nombrePaquete">Nombre del paquete</label>
                        <input
                          id="nombrePaquete"
                          className="aur-input"
                          value={formData.nombrePaquete}
                          onChange={e => updateFormField('nombrePaquete', e.target.value)}
                          maxLength={MAX_NOMBRE_PAQUETE}
                          required
                        />
                      </div>
                      <div className="aur-row">
                        <label className="aur-row-label" htmlFor="tecnicoResponsable">Técnico responsable</label>
                        <input
                          id="tecnicoResponsable"
                          className="aur-input"
                          value={formData.tecnicoResponsable}
                          onChange={e => updateFormField('tecnicoResponsable', e.target.value)}
                          placeholder="Nombre del técnico responsable"
                          maxLength={MAX_TECNICO}
                        />
                      </div>
                      <div className="aur-row aur-row--multiline">
                        <label className="aur-row-label" htmlFor="descripcion">Descripción</label>
                        <textarea
                          id="descripcion"
                          className="aur-textarea"
                          value={formData.descripcion}
                          onChange={e => updateFormField('descripcion', e.target.value)}
                          placeholder="Ej: Paquete de muestreo fitosanitario para etapa de desarrollo."
                          maxLength={MAX_DESCRIPCION}
                          rows={3}
                        />
                      </div>
                    </div>
                  </section>

                  <ActivitiesEditor
                    activities={formData.activities}
                    users={users}
                    plantillas={plantillas}
                    onChange={updateActivities}
                    autoExpandFirst
                  />

                  <div className="aur-form-actions">
                    <button type="button" className="aur-btn-text" onClick={cancelNew}>Cancelar</button>
                    <button type="submit" className="aur-btn-pill">Crear paquete</button>
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
