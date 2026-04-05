import { useState, useEffect, useRef } from 'react';
import { FiPlus, FiTrash2, FiEdit2, FiCheck, FiX, FiToggleLeft, FiToggleRight, FiClipboard, FiChevronRight, FiArrowLeft, FiMove, FiLock } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './Monitoreo.css';

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
    <div className="campos-editor">
      <div className="campos-default-section">
        <p className="campos-section-divider">Campos predeterminados</p>
        {DEFAULT_CAMPOS.map((campo, i) => (
          <div key={`def-${i}`} className="campo-row campo-row--default">
            <span className="campo-drag-handle" style={{ visibility: 'hidden' }}>
              <FiMove size={13} />
            </span>
            <input className="campo-nombre-input" value={campo.nombre} disabled readOnly />
            <select value={campo.tipo} disabled>
              {TIPO_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span className="campo-lock-icon" title="Campo predeterminado del sistema">
              <FiLock size={12} />
            </span>
          </div>
        ))}
      </div>

      <p className="campos-section-divider">Campos personalizados</p>
      {campos.map((campo, i) => (
        <div
          key={i}
          className={`campo-row${dragOverIdx === i ? ' campo-row--over' : ''}`}
          draggable={!disabled}
          onDragStart={e => handleDragStart(e, i)}
          onDragEnter={() => handleDragEnter(i)}
          onDragOver={handleDragOver}
          onDrop={e => handleDrop(e, i)}
          onDragEnd={handleDragEnd}
        >
          <span className="campo-drag-handle" title="Arrastrar para reordenar">
            <FiMove size={13} />
          </span>
          <input
            className="campo-nombre-input"
            value={campo.nombre}
            onChange={e => updateCampo(i, 'nombre', e.target.value)}
            placeholder="Nombre del campo"
            disabled={disabled}
          />
          <select
            value={campo.tipo}
            onChange={e => updateCampo(i, 'tipo', e.target.value)}
            disabled={disabled}
          >
            {TIPO_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="icon-btn delete"
            onClick={() => removeCampo(i)}
            disabled={disabled}
            title="Eliminar campo"
          >
            <FiTrash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-add-campo"
        onClick={addCampo}
        disabled={disabled}
      >
        <FiPlus size={13} /> Agregar campo
      </button>
    </div>
  );
}

function MonitoreoConfig() {
  const apiFetch = useApiFetch();
  const [tipos, setTipos]               = useState([]);
  const [selectedTipo, setSelectedTipo] = useState(null);
  const [editingId, setEditingId]       = useState(null);
  const [editData, setEditData]         = useState(null);
  const [showNew, setShowNew]           = useState(false);
  const [newTipo, setNewTipo]           = useState({ nombre: '', campos: [] });
  const [toast, setToast]               = useState(null);
  const [loading, setLoading]           = useState(true);
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
    try {
      const body = { nombre: editData.nombre, campos: editData.campos };
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
    if (!newTipo.nombre.trim()) { showToast('El nombre es obligatorio.', 'error'); return; }
    try {
      const body = { nombre: newTipo.nombre, campos: newTipo.campos };
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

  const handleDelete = async (tipo) => {
    if (!confirm('¿Eliminar esta plantilla de muestreo?')) return;
    try {
      await apiFetch(`/api/monitoreo/tipos/${tipo.id}`, { method: 'DELETE' });
      setTipos(prev => prev.filter(t => t.id !== tipo.id));
      if (selectedTipo?.id === tipo.id) setSelectedTipo(null);
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
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <FiPlus size={14} /> Crear el primero
          </button>
        </div>
      ) : (
        <>
          {!selectedTipo && (
            <div className="lote-page-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="lote-list-title">Plantillas de muestreo</h3>
              <button className="btn btn-primary" onClick={() => { setShowNew(true); setSelectedTipo(null); }}>
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
                        <button className="icon-btn" style={{ color: 'var(--aurora-green)', opacity: 1 }} onClick={saveEdit} title="Guardar"><FiCheck size={16} /></button>
                        <button className="icon-btn" onClick={cancelEdit} title="Cancelar"><FiX size={16} /></button>
                      </>
                    ) : (
                      <>
                        <button className="icon-btn" onClick={() => toggleActivo(selectedTipo)} title={selectedTipo.activo ? 'Desactivar' : 'Activar'}>
                          {selectedTipo.activo
                            ? <FiToggleRight size={18} style={{ color: 'var(--aurora-green)' }} />
                            : <FiToggleLeft size={18} />}
                        </button>
                        <button className="icon-btn" onClick={() => startEdit(selectedTipo)} title="Editar"><FiEdit2 size={15} /></button>
                        <button className="icon-btn delete" onClick={() => handleDelete(selectedTipo)} title="Eliminar"><FiTrash2 size={15} /></button>
                      </>
                    )}
                  </div>
                </div>

                {editingId === selectedTipo.id ? (
                  <div className="tipo-campos-edit">
                    <p className="campos-edit-label">Campos del formulario</p>
                    <CamposEditor
                      campos={editData.campos}
                      onChange={campos => setEditData(prev => ({ ...prev, campos }))}
                    />
                  </div>
                ) : (
                  <div className="tipo-campos-preview">
                    <span className="campos-section-divider" style={{ width: '100%' }}>Campos predeterminados</span>
                    {DEFAULT_CAMPOS.map((c, i) => (
                      <span key={`def-${i}`} className="campo-chip campo-chip--default" title="Campo predeterminado del sistema">
                        {c.nombre}
                      </span>
                    ))}
                    <span className="campos-section-divider" style={{ width: '100%', marginTop: '0.5rem' }}>Campos personalizados</span>
                    {(selectedTipo.campos || []).length === 0 ? (
                      <span className="label-optional">Sin campos adicionales</span>
                    ) : (
                      (selectedTipo.campos || []).map((c, i) => (
                        <span key={i} className="campo-chip">
                          {c.nombre}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : showNew ? (
              <div className="form-card">
                <p className="form-section-title">Nueva Plantilla de Muestreo</p>
                <div className="form-control">
                  <label>Nombre</label>
                  <input
                    value={newTipo.nombre}
                    onChange={e => setNewTipo(prev => ({ ...prev, nombre: e.target.value }))}
                    placeholder="Ej: Muestreo de pH"
                  />
                </div>
                <div className="tipo-campos-edit" style={{ marginTop: '0.75rem' }}>
                  <p className="campos-edit-label">Campos del formulario</p>
                  <CamposEditor
                    campos={newTipo.campos}
                    onChange={campos => setNewTipo(prev => ({ ...prev, campos }))}
                  />
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" onClick={saveNew}>Crear plantilla</button>
                  <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
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
    </div>
  );
}

export default MonitoreoConfig;
