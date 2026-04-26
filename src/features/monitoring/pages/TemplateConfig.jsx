import { useState, useEffect, useRef } from 'react';
import { FiPlus, FiTrash2, FiEdit2, FiCheck, FiX, FiToggleLeft, FiToggleRight, FiClipboard, FiChevronRight, FiArrowLeft, FiMove, FiLock } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../../applications/styles/packages.css';
import '../styles/monitoring.css';

const TIPO_OPTIONS = [
  { value: 'texto',  label: 'Texto' },
  { value: 'numero', label: 'Número' },
  { value: 'fecha',  label: 'Fecha' },
];

const DEFAULT_CAMPOS = [
  { nombre: 'F. Programada', tipo: 'fecha' },
  { nombre: 'F. Muestreo',   tipo: 'fecha' },
  { nombre: 'Muestreador',   tipo: 'texto' },
  { nombre: 'Supervisor',    tipo: 'texto' },
  { nombre: 'Lote',          tipo: 'texto' },
  { nombre: 'Grupo',         tipo: 'texto' },
  { nombre: 'Notas',         tipo: 'texto' },
];

const emptyCampo = () => ({ nombre: '', tipo: 'numero' });

const MAX_NOMBRE_PLANTILLA = 60;
const MAX_NOMBRE_CAMPO = 40;

const sanitizePayload = (nombre, campos) => {
  const trimmedNombre = (nombre || '').trim();
  if (!trimmedNombre) return { ok: false, message: 'El nombre es obligatorio.' };
  if (trimmedNombre.length > MAX_NOMBRE_PLANTILLA) {
    return { ok: false, message: `El nombre excede ${MAX_NOMBRE_PLANTILLA} caracteres.` };
  }
  const cleanCampos = [];
  for (const c of (campos || [])) {
    const nom = (c.nombre || '').trim();
    if (!nom) return { ok: false, message: 'Todos los campos deben tener nombre.' };
    if (nom.length > MAX_NOMBRE_CAMPO) {
      return { ok: false, message: `Nombre de campo excede ${MAX_NOMBRE_CAMPO} caracteres.` };
    }
    cleanCampos.push({ nombre: nom, tipo: c.tipo });
  }
  return { ok: true, nombre: trimmedNombre, campos: cleanCampos };
};

function CamposEditor({ campos, onChange, disabled }) {
  const dragIdx = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const addCampo = () => onChange([...campos, emptyCampo()]);
  const removeCampo = (i) => onChange(campos.filter((_, idx) => idx !== i));
  const updateCampo = (i, key, val) =>
    onChange(campos.map((c, idx) => idx === i ? { ...c, [key]: val } : c));

  const handleDragStart = (e, i) => {
    dragIdx.current = i;
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragEnter = (i) => {
    if (dragIdx.current !== null && dragIdx.current !== i) setDragOverIdx(i);
  };
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDrop = (e, i) => {
    e.preventDefault();
    const from = dragIdx.current;
    dragIdx.current = null;
    setDragOverIdx(null);
    if (from === null || from === i) return;
    const reordered = [...campos];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(i, 0, moved);
    onChange(reordered);
  };
  const handleDragEnd = () => { dragIdx.current = null; setDragOverIdx(null); };

  return (
    <>
      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num">⚐</span>
          <h3>Campos predeterminados</h3>
          <span className="aur-section-count">{DEFAULT_CAMPOS.length}</span>
        </div>
        <ul className="tpl-campos-list">
          {DEFAULT_CAMPOS.map((campo, i) => (
            <li key={`def-${i}`} className="tpl-campo-card tpl-campo-card--default">
              <span className="tpl-campo-handle" title="Campo predeterminado del sistema" aria-hidden="true">
                <FiLock size={12} />
              </span>
              <input
                className="aur-input tpl-campo-name"
                value={campo.nombre}
                disabled
                readOnly
                aria-label="Nombre del campo"
              />
              <select className="aur-chip" value={campo.tipo} disabled aria-label="Tipo">
                {TIPO_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num">+</span>
          <h3>Campos personalizados</h3>
          <span className="aur-section-count">{campos.length}</span>
        </div>
        {campos.length > 0 && (
          <ul className="tpl-campos-list">
            {campos.map((campo, i) => (
              <li
                key={i}
                className={`tpl-campo-card${dragOverIdx === i ? ' is-dragover' : ''}`}
                draggable={!disabled}
                onDragStart={e => handleDragStart(e, i)}
                onDragEnter={() => handleDragEnter(i)}
                onDragOver={handleDragOver}
                onDrop={e => handleDrop(e, i)}
                onDragEnd={handleDragEnd}
              >
                <span className="tpl-campo-handle" title="Arrastrar para reordenar">
                  <FiMove size={13} />
                </span>
                <input
                  className="aur-input tpl-campo-name"
                  value={campo.nombre}
                  onChange={e => updateCampo(i, 'nombre', e.target.value)}
                  placeholder="Nombre del campo"
                  maxLength={MAX_NOMBRE_CAMPO}
                  disabled={disabled}
                  aria-label="Nombre del campo"
                />
                <select
                  className="aur-chip"
                  value={campo.tipo}
                  onChange={e => updateCampo(i, 'tipo', e.target.value)}
                  disabled={disabled}
                  aria-label="Tipo"
                >
                  {TIPO_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                  onClick={() => removeCampo(i)}
                  disabled={disabled}
                  title="Eliminar campo"
                >
                  <FiTrash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="pkg-add-activity"
          onClick={addCampo}
          disabled={disabled}
        >
          <FiPlus size={14} /> Agregar campo
        </button>
      </section>
    </>
  );
}

function TemplateConfig() {
  const apiFetch = useApiFetch();
  const [tipos, setTipos]               = useState([]);
  const [selectedTipo, setSelectedTipo] = useState(null);
  const [editingId, setEditingId]       = useState(null);
  const [editData, setEditData]         = useState(null);
  const [showNew, setShowNew]           = useState(false);
  const [newTipo, setNewTipo]           = useState({ nombre: '', campos: [] });
  const [toast, setToast]               = useState(null);
  const [loading, setLoading]           = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const carouselRef = useRef(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    if (!selectedTipo || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedTipo]);

  useEffect(() => {
    apiFetch('/api/monitoreo/tipos')
      .then(r => r.json())
      .then(setTipos)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const toggleActivo = async (tipo) => {
    try {
      await apiFetch(`/api/monitoreo/tipos/${tipo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !tipo.activo }),
      });
      const updated = { ...tipo, activo: !tipo.activo };
      setTipos(prev => prev.map(t => t.id === tipo.id ? updated : t));
      setSelectedTipo(prev => prev?.id === tipo.id ? updated : prev);
    } catch {
      showToast('Error al actualizar.', 'error');
    }
  };

  const startEdit = (tipo) => {
    setEditingId(tipo.id);
    setEditData({
      nombre: tipo.nombre,
      campos: tipo.campos ? tipo.campos.map(c => ({ ...c })) : [],
    });
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    const clean = sanitizePayload(editData?.nombre, editData?.campos);
    if (!clean.ok) { showToast(clean.message, 'error'); return; }
    try {
      const body = { nombre: clean.nombre, campos: clean.campos };
      await apiFetch(`/api/monitoreo/tipos/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setTipos(prev => prev.map(t => t.id === editingId ? { ...t, ...body } : t));
      setSelectedTipo(prev => prev?.id === editingId ? { ...prev, ...body } : prev);
      setEditingId(null);
      showToast('Plantilla actualizada.');
    } catch {
      showToast('Error al guardar.', 'error');
    }
  };

  const saveNew = async () => {
    const clean = sanitizePayload(newTipo.nombre, newTipo.campos);
    if (!clean.ok) { showToast(clean.message, 'error'); return; }
    try {
      const body = { nombre: clean.nombre, campos: clean.campos };
      const res = await apiFetch('/api/monitoreo/tipos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const { id } = await res.json();
      setTipos(prev => [...prev, { id, ...body, activo: true }]);
      setNewTipo({ nombre: '', campos: [] });
      setShowNew(false);
      showToast('Plantilla de muestreo creada.');
    } catch {
      showToast('Error al crear.', 'error');
    }
  };

  const doDelete = async (tipo) => {
    try {
      await apiFetch(`/api/monitoreo/tipos/${tipo.id}`, { method: 'DELETE' });
      setTipos(prev => prev.filter(t => t.id !== tipo.id));
      if (selectedTipo?.id === tipo.id) setSelectedTipo(null);
      if (editingId === tipo.id) setEditingId(null);
      showToast('Plantilla eliminada.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const handleSelectTipo = (tipo) => {
    setSelectedTipo(tipo);
    setShowNew(false);
    setEditingId(null);
  };

  return (
    <div className={`lote-page${selectedTipo ? ' lote-page--selected' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {loading ? (
        <div className="mon-loading" />
      ) : tipos.length === 0 && !showNew ? (
        <div className="mon-empty-state">
          <FiClipboard size={36} />
          <p>No hay plantillas de muestreo creadas</p>
          <button className="aur-btn-pill" onClick={() => setShowNew(true)}>
            <FiPlus size={14} /> Crear el primero
          </button>
        </div>
      ) : (
        <>
          {!selectedTipo && (
            <div className="lote-page-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="lote-list-title">Plantillas de muestreo</h3>
              <button className="aur-btn-pill" onClick={() => { setShowNew(true); setSelectedTipo(null); }}>
                <FiPlus size={16} /> Nueva plantilla
              </button>
            </div>
          )}

          {selectedTipo && (
            <div className="lote-carousel" ref={carouselRef}>
              {tipos.map(tipo => (
                <button
                  key={tipo.id}
                  className={`lote-bubble${selectedTipo?.id === tipo.id ? ' lote-bubble--active' : ''}`}
                  onClick={() => selectedTipo?.id === tipo.id ? setSelectedTipo(null) : handleSelectTipo(tipo)}
                >
                  <span className="lote-bubble-avatar">{tipo.nombre.slice(0, 4)}</span>
                  <span className="lote-bubble-label">{tipo.nombre}</span>
                </button>
              ))}
              <button
                className="lote-bubble lote-bubble--add"
                onClick={() => { setSelectedTipo(null); setShowNew(true); }}
              >
                <span className="lote-bubble-avatar lote-bubble-avatar--add">+</span>
                <span className="lote-bubble-label">Nueva</span>
              </button>
            </div>
          )}

          <div className="lote-management-layout">
            {selectedTipo ? (
              <div className="lote-hub">
                <button className="lote-hub-back" onClick={() => { setSelectedTipo(null); setEditingId(null); }}>
                  <FiArrowLeft size={13} /> Todas las plantillas
                </button>

                <div className="hub-header">
                  <div className="hub-title-block">
                    {editingId === selectedTipo.id ? (
                      <input
                        className="tipo-nombre-input"
                        value={editData.nombre}
                        onChange={e => setEditData(prev => ({ ...prev, nombre: e.target.value }))}
                        maxLength={MAX_NOMBRE_PLANTILLA}
                      />
                    ) : (
                      <>
                        <h2 className="hub-lote-code">{selectedTipo.nombre}</h2>
                        {!selectedTipo.activo && <span className="label-optional">(inactivo)</span>}
                      </>
                    )}
                  </div>
                  <div className="hub-header-actions">
                    {editingId === selectedTipo.id ? (
                      <>
                        <button className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--success" onClick={saveEdit} title="Guardar"><FiCheck size={16} /></button>
                        <button className="aur-icon-btn aur-icon-btn--sm" onClick={cancelEdit} title="Cancelar"><FiX size={16} /></button>
                      </>
                    ) : (
                      <>
                        <button className="aur-icon-btn aur-icon-btn--sm" onClick={() => toggleActivo(selectedTipo)} title={selectedTipo.activo ? 'Desactivar' : 'Activar'}>
                          {selectedTipo.activo
                            ? <FiToggleRight size={18} style={{ color: 'var(--aurora-green)' }} />
                            : <FiToggleLeft size={18} />}
                        </button>
                        <button className="aur-icon-btn aur-icon-btn--sm" onClick={() => startEdit(selectedTipo)} title="Editar"><FiEdit2 size={15} /></button>
                        <button className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger" onClick={() => setConfirmDelete(selectedTipo)} title="Eliminar"><FiTrash2 size={15} /></button>
                      </>
                    )}
                  </div>
                </div>

                {editingId === selectedTipo.id ? (
                  <CamposEditor
                    campos={editData.campos}
                    onChange={campos => setEditData(prev => ({ ...prev, campos }))}
                  />
                ) : (
                  <div className="tpl-preview">
                    <section className="aur-section">
                      <div className="aur-section-header">
                        <span className="aur-section-num">⚐</span>
                        <h3>Campos predeterminados</h3>
                        <span className="aur-section-count">{DEFAULT_CAMPOS.length}</span>
                      </div>
                      <div className="tpl-chips">
                        {DEFAULT_CAMPOS.map((c, i) => (
                          <span
                            key={`def-${i}`}
                            className="aur-badge aur-badge--gray"
                            title="Campo predeterminado del sistema"
                          >
                            {c.nombre}
                          </span>
                        ))}
                      </div>
                    </section>
                    <section className="aur-section">
                      <div className="aur-section-header">
                        <span className="aur-section-num">+</span>
                        <h3>Campos personalizados</h3>
                        <span className="aur-section-count">{(selectedTipo.campos || []).length}</span>
                      </div>
                      {(selectedTipo.campos || []).length === 0 ? (
                        <div className="tpl-empty">Sin campos adicionales</div>
                      ) : (
                        <div className="tpl-chips">
                          {selectedTipo.campos.map((c, i) => (
                            <span key={i} className="aur-badge aur-badge--magenta">
                              {c.nombre}
                            </span>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </div>
            ) : showNew ? (
              <div className="aur-sheet">
                <div className="tpl-form tpl-form--new">
                  <section className="aur-section">
                    <div className="aur-section-header">
                      <span className="aur-section-num">+</span>
                      <h3>Nueva plantilla de muestreo</h3>
                    </div>
                    <div className="aur-list">
                      <div className="aur-row">
                        <label className="aur-row-label" htmlFor="tpl-nombre">Nombre</label>
                        <input
                          id="tpl-nombre"
                          className="aur-input"
                          value={newTipo.nombre}
                          onChange={e => setNewTipo(prev => ({ ...prev, nombre: e.target.value }))}
                          placeholder="Ej: Muestreo de pH"
                          maxLength={MAX_NOMBRE_PLANTILLA}
                        />
                      </div>
                    </div>
                  </section>
                  <CamposEditor
                    campos={newTipo.campos}
                    onChange={campos => setNewTipo(prev => ({ ...prev, campos }))}
                  />
                  <div className="aur-form-actions">
                    <button type="button" className="aur-btn-text" onClick={() => setShowNew(false)}>Cancelar</button>
                    <button type="button" className="aur-btn-pill" onClick={saveNew}>Crear plantilla</button>
                  </div>
                </div>
              </div>
            ) : null}

            {!showNew && (
              <div className="lote-list-panel">
                <ul className="lote-list">
                  {tipos.map(tipo => (
                    <li
                      key={tipo.id}
                      className={`lote-list-item${selectedTipo?.id === tipo.id ? ' active' : ''}`}
                      onClick={() => selectedTipo?.id === tipo.id ? setSelectedTipo(null) : handleSelectTipo(tipo)}
                    >
                      <div className="lote-list-info">
                        <span className={`lote-list-code${!tipo.activo ? ' tipo-inactivo' : ''}`}>{tipo.nombre}</span>
                        {!tipo.activo && <span className="lote-list-name">Inactivo</span>}
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

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar plantilla"
          body={`¿Eliminar la plantilla "${confirmDelete.nombre}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => { doDelete(confirmDelete); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default TemplateConfig;
