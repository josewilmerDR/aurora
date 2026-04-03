import { useState, useEffect, useRef } from 'react';
import { FiPlus, FiTrash2, FiEdit2, FiCheck, FiX, FiToggleLeft, FiToggleRight, FiPaperclip, FiFile, FiClipboard, FiChevronRight, FiArrowLeft } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import './Monitoreo.css';

function MonitoreoConfig() {
  const apiFetch = useApiFetch();
  const [tipos, setTipos]             = useState([]);
  const [selectedTipo, setSelectedTipo] = useState(null);
  const [editingId, setEditingId]     = useState(null);
  const [editData, setEditData]       = useState(null);
  const [showNew, setShowNew]         = useState(false);
  const [newTipo, setNewTipo]         = useState({ nombre: '', archivoFormulario: null });
  const [toast, setToast]             = useState(null);
  const [uploadingNew, setUploadingNew]   = useState(false);
  const [uploadingEdit, setUploadingEdit] = useState(false);
  const [pendingDeletePath, setPendingDeletePath] = useState(null);
  const [loading, setLoading] = useState(true);
  const carouselRef = useRef(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  // Centra la burbuja activa en el carrusel cuando cambia la plantilla seleccionada
  useEffect(() => {
    if (!selectedTipo || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedTipo]);

  useEffect(() => {
    apiFetch('/api/monitoreo/tipos').then(r => r.json()).then(setTipos).catch(console.error).finally(() => setLoading(false));
  }, []);

  // ── Subir archivo ──────────────────────────────────────────────────────────
  const uploadArchivo = async (file) => {
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `plantillas-muestreo/${Date.now()}_${sanitized}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    return { nombre: file.name, url, storagePath: path };
  };

  const handleUploadNew = async (file) => {
    setUploadingNew(true);
    try {
      const archivo = await uploadArchivo(file);
      setNewTipo(prev => ({ ...prev, archivoFormulario: archivo }));
    } catch {
      showToast('Error al subir el archivo.', 'error');
    } finally {
      setUploadingNew(false);
    }
  };

  const handleRemoveNew = async () => {
    if (newTipo.archivoFormulario?.storagePath) {
      try { await deleteObject(ref(storage, newTipo.archivoFormulario.storagePath)); } catch { /* ya no existe */ }
    }
    setNewTipo(prev => ({ ...prev, archivoFormulario: null }));
  };

  const handleUploadEdit = async (file) => {
    setUploadingEdit(true);
    try {
      const archivo = await uploadArchivo(file);
      const body = { nombre: editData.nombre, archivoFormulario: archivo };
      await apiFetch(`/api/monitoreo/tipos/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (pendingDeletePath) {
        try { await deleteObject(ref(storage, pendingDeletePath)); } catch { /* ya no existe */ }
        setPendingDeletePath(null);
      }
      setEditData(prev => ({ ...prev, archivoFormulario: archivo }));
      setTipos(prev => prev.map(t => t.id === editingId ? { ...t, ...body } : t));
      setSelectedTipo(prev => prev?.id === editingId ? { ...prev, ...body } : prev);
      showToast('Formulario actualizado.');
    } catch {
      showToast('Error al subir o guardar el archivo.', 'error');
    } finally {
      setUploadingEdit(false);
    }
  };

  const handleRemoveEdit = () => {
    if (editData.archivoFormulario?.storagePath) {
      setPendingDeletePath(editData.archivoFormulario.storagePath);
    }
    setEditData(prev => ({ ...prev, archivoFormulario: null }));
  };

  // ── Toggle activo ──────────────────────────────────────────────────────────
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

  // ── Editar ─────────────────────────────────────────────────────────────────
  const startEdit = (tipo) => {
    setEditingId(tipo.id);
    setPendingDeletePath(null);
    setEditData({
      nombre: tipo.nombre,
      archivoFormulario: tipo.archivoFormulario || null,
    });
  };

  const cancelEdit = () => {
    setPendingDeletePath(null);
    setEditingId(null);
  };

  const saveEdit = async () => {
    try {
      const body = { nombre: editData.nombre, archivoFormulario: editData.archivoFormulario || null };
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

  // ── Nueva plantilla ────────────────────────────────────────────────────────
  const saveNew = async () => {
    if (!newTipo.nombre.trim()) { showToast('El nombre es obligatorio.', 'error'); return; }
    try {
      const body = { nombre: newTipo.nombre, ...(newTipo.archivoFormulario ? { archivoFormulario: newTipo.archivoFormulario } : {}) };
      const res = await apiFetch('/api/monitoreo/tipos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const { id } = await res.json();
      setTipos(prev => [...prev, { id, ...body, activo: true }]);
      setNewTipo({ nombre: '', archivoFormulario: null });
      setShowNew(false);
      showToast('Plantilla de muestreo creada.');
    } catch {
      showToast('Error al crear.', 'error');
    }
  };

  const handleDelete = async (tipo) => {
    if (!confirm('¿Eliminar esta plantilla de muestreo?')) return;
    try {
      if (tipo.archivoFormulario?.storagePath) {
        try { await deleteObject(ref(storage, tipo.archivoFormulario.storagePath)); } catch { /* ya no existe */ }
      }
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

  // ── UI adjuntar formulario ─────────────────────────────────────────────────
  const ArchivoField = ({ archivo, onUpload, onRemove, uploading }) => (
    <div className="form-control" style={{ marginTop: '0.75rem' }}>
      <label>Adjuntar formulario</label>
      {archivo ? (
        <div className="excel-file-row">
          <FiFile size={14} className="excel-file-icon" />
          <a href={archivo.url} className="excel-file-name" target="_blank" rel="noreferrer">
            {archivo.nombre}
          </a>
          <button type="button" className="product-tag-remove" onClick={onRemove} title="Quitar archivo">
            <FiX size={13} />
          </button>
        </div>
      ) : (
        <label className={`excel-upload-btn${uploading ? ' excel-upload-btn--loading' : ''}`}>
          <FiPaperclip size={13} />
          {uploading ? 'Subiendo...' : 'Adjuntar archivo (.xlsx, .xls, .pdf)'}
          <input
            type="file"
            accept=".xlsx,.xls,.pdf"
            style={{ display: 'none' }}
            disabled={uploading}
            onChange={e => { if (e.target.files[0]) onUpload(e.target.files[0]); e.target.value = ''; }}
          />
        </label>
      )}
    </div>
  );

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

          {/* ── Carrusel móvil ── */}
          {selectedTipo && (
            <div className="lote-carousel" ref={carouselRef}>
              {tipos.map(tipo => (
                <button
                  key={tipo.id}
                  className={`lote-bubble${selectedTipo?.id === tipo.id ? ' lote-bubble--active' : ''}`}
                  onClick={() => selectedTipo?.id === tipo.id ? setSelectedTipo(null) : handleSelectTipo(tipo)}
                >
                  <span className="lote-bubble-avatar">
                    {tipo.nombre.slice(0, 4)}
                  </span>
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
            {/* ── Panel principal ── */}
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
                  <ArchivoField
                    archivo={editData.archivoFormulario}
                    onUpload={handleUploadEdit}
                    onRemove={handleRemoveEdit}
                    uploading={uploadingEdit}
                  />
                ) : (
                  selectedTipo.archivoFormulario && (
                    <div className="tipo-campos-preview">
                      <a href={selectedTipo.archivoFormulario.url} className="excel-file-name" target="_blank" rel="noreferrer">
                        <FiFile size={13} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                        {selectedTipo.archivoFormulario.nombre}
                      </a>
                    </div>
                  )
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
                <ArchivoField
                  archivo={newTipo.archivoFormulario}
                  onUpload={handleUploadNew}
                  onRemove={handleRemoveNew}
                  uploading={uploadingNew}
                />
                <div className="form-actions">
                  <button className="btn btn-primary" onClick={saveNew}>Crear plantilla</button>
                  <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
                </div>
              </div>
            ) : null}

            {/* ── Lista lateral ── */}
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
