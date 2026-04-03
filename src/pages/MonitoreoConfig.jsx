import { useState, useEffect } from 'react';
import { FiPlus, FiTrash2, FiEdit2, FiCheck, FiX, FiToggleLeft, FiToggleRight, FiPaperclip, FiFile } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import './Monitoreo.css';

function MonitoreoConfig() {
  const apiFetch = useApiFetch();
  const [tipos, setTipos]         = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData]   = useState(null);
  const [showNew, setShowNew]     = useState(false);
  const [newTipo, setNewTipo]     = useState({ nombre: '', archivoFormulario: null });
  const [toast, setToast]         = useState(null);
  const [uploadingNew, setUploadingNew]   = useState(false);
  const [uploadingEdit, setUploadingEdit] = useState(false);
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    apiFetch('/api/monitoreo/tipos').then(r => r.json()).then(setTipos).catch(console.error);
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
      setEditData(prev => ({ ...prev, archivoFormulario: archivo }));
    } catch {
      showToast('Error al subir el archivo.', 'error');
    } finally {
      setUploadingEdit(false);
    }
  };

  const handleRemoveEdit = async () => {
    if (editData.archivoFormulario?.storagePath) {
      try { await deleteObject(ref(storage, editData.archivoFormulario.storagePath)); } catch { /* ya no existe */ }
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
      setTipos(prev => prev.map(t => t.id === tipo.id ? { ...t, activo: !t.activo } : t));
    } catch {
      showToast('Error al actualizar.', 'error');
    }
  };

  // ── Editar ─────────────────────────────────────────────────────────────────
  const startEdit = (tipo) => {
    setEditingId(tipo.id);
    setEditData({
      nombre: tipo.nombre,
      archivoFormulario: tipo.archivoFormulario || null,
    });
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
      showToast('Plantilla eliminada.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
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
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="page-toolbar">
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <FiPlus size={16} /> Nueva plantilla
        </button>
      </div>

      {/* Formulario nueva plantilla */}
      {showNew && (
        <div className="form-card" style={{ marginBottom: '1rem' }}>
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
      )}

      {/* Lista de plantillas */}
      <div className="items-list">
        {tipos.map(tipo => (
          <div key={tipo.id} className="item-card">
            <div className="item-card-header">
              {editingId === tipo.id ? (
                <input
                  className="tipo-nombre-input"
                  value={editData.nombre}
                  onChange={e => setEditData(prev => ({ ...prev, nombre: e.target.value }))}
                />
              ) : (
                <span className={`item-main-text${!tipo.activo ? ' tipo-inactivo' : ''}`}>
                  {tipo.nombre}
                  {!tipo.activo && <span className="label-optional"> (inactivo)</span>}
                </span>
              )}
              <div className="item-actions">
                {editingId === tipo.id ? (
                  <>
                    <button className="btn-icon btn-success" onClick={saveEdit} title="Guardar"><FiCheck size={16} /></button>
                    <button className="btn-icon" onClick={() => setEditingId(null)} title="Cancelar"><FiX size={16} /></button>
                  </>
                ) : (
                  <>
                    <button className="btn-icon" onClick={() => toggleActivo(tipo)} title={tipo.activo ? 'Desactivar' : 'Activar'}>
                      {tipo.activo ? <FiToggleRight size={18} style={{ color: 'var(--aurora-green)' }} /> : <FiToggleLeft size={18} />}
                    </button>
                    <button className="btn-icon" onClick={() => startEdit(tipo)} title="Editar"><FiEdit2 size={15} /></button>
                    <button className="btn-icon btn-danger" onClick={() => handleDelete(tipo)} title="Eliminar"><FiTrash2 size={15} /></button>
                  </>
                )}
              </div>
            </div>

            {editingId === tipo.id ? (
              <ArchivoField
                archivo={editData.archivoFormulario}
                onUpload={handleUploadEdit}
                onRemove={handleRemoveEdit}
                uploading={uploadingEdit}
              />
            ) : (
              tipo.archivoFormulario && (
                <div className="tipo-campos-preview">
                  <a href={tipo.archivoFormulario.url} className="excel-file-name" target="_blank" rel="noreferrer">
                    <FiFile size={13} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                    {tipo.archivoFormulario.nombre}
                  </a>
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default MonitoreoConfig;
