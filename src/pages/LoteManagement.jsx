import { useState, useEffect } from 'react';
import './LoteManagement.css';
import { FiEdit, FiTrash2, FiPlus } from 'react-icons/fi';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';

function LoteManagement() {
  const [lotes, setLotes] = useState([]);
  const [packages, setPackages] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });
  const [confirmModal, setConfirmModal] = useState(null); // { loteId, loteName, taskCount }
  const [deleting, setDeleting] = useState(false);
  const [formData, setFormData] = useState({
    id: null,
    nombreLote: '',
    fechaCreacion: '',
    paqueteId: '',
    hectareas: ''
  });

  // --- LÓGICA DE DATOS (sin cambios) ---
  const fetchLotes = () => {
    fetch('/api/lotes').then(res => res.json()).then(setLotes).catch(console.error);
  };
  const fetchPackages = () => {
    fetch('/api/packages').then(res => res.json()).then(setPackages).catch(console.error);
  };
  useEffect(() => {
    fetchLotes();
    fetchPackages();
  }, []);

  const formatDateForInput = (timestamp) => {
    const date = new Date(timestamp._seconds * 1000);
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    return date.toISOString().split('T')[0];
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setIsEditing(false);
    setFormData({ id: null, nombreLote: '', fechaCreacion: '', paqueteId: '', hectareas: '' });
  };

  const handleEdit = (lote) => {
    setIsEditing(true);
    setFormData({
      id: lote.id,
      nombreLote: lote.nombreLote,
      fechaCreacion: formatDateForInput(lote.fechaCreacion),
      paqueteId: lote.paqueteId,
      hectareas: lote.hectareas || ''
    });
    window.scrollTo(0, 0);
  };

  const handleDeleteClick = async (lote) => {
    try {
      const res = await fetch(`/api/lotes/${lote.id}/task-count`);
      const { count } = await res.json();
      setConfirmModal({ loteId: lote.id, loteName: lote.nombreLote, taskCount: count });
    } catch {
      showToast('Error al verificar las tareas del lote.', 'error');
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/lotes/${confirmModal.loteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar');
      setConfirmModal(null);
      fetchLotes();
      showToast('Lote eliminado correctamente');
    } catch {
      showToast('Error al eliminar el lote.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/lotes/${formData.id}` : '/api/lotes';
    const method = isEditing ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, { 
        method, 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Error al guardar el lote');
      fetchLotes();
      resetForm();
      showToast(isEditing ? 'Lote actualizado correctamente' : 'Lote creado y tareas programadas');
    } catch (error) {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };
  // --- FIN DE LA LÓGICA ---

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && (
        <ConfirmModal
          title={`¿Eliminar "${confirmModal.loteName}"?`}
          message={
            confirmModal.taskCount > 0
              ? `Esta acción eliminará permanentemente el lote y sus ${confirmModal.taskCount} tarea(s) programada(s). No se puede deshacer.`
              : 'Este lote no tiene tareas asociadas. Solo se eliminará el registro del lote. No se puede deshacer.'
          }
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmModal(null)}
          loading={deleting}
        />
      )}
      {/* --- TARJETA DEL FORMULARIO --- */}
      <div className="form-card">
        <h2>{isEditing ? 'Editando Lote' : 'Crear Nuevo Lote'}</h2>
        <form onSubmit={handleSubmit} className="lote-form">
          <div className="form-grid">
            <div className="form-control">
              <label htmlFor="nombreLote">Nombre del Lote</label>
              <input id="nombreLote" name="nombreLote" value={formData.nombreLote} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="fechaCreacion">Fecha de Creación</label>
              <input id="fechaCreacion" name="fechaCreacion" value={formData.fechaCreacion} onChange={handleInputChange} type="date" required />
            </div>
            <div className="form-control">
              <label htmlFor="paqueteId">Paquete de Tareas</label>
              <select id="paqueteId" name="paqueteId" value={formData.paqueteId} onChange={handleInputChange}>
                <option value="">-- Seleccionar Paquete --</option>
                {packages.map(pkg => <option key={pkg.id} value={pkg.id}>{pkg.nombrePaquete}</option>)}
              </select>
            </div>
            <div className="form-control">
              <label htmlFor="hectareas">Hectáreas</label>
              <input id="hectareas" name="hectareas" type="number" step="0.01" min="0.01" value={formData.hectareas} onChange={handleInputChange} placeholder="Ej: 2.5" />
            </div>
          </div>
          {formData.paqueteId && (() => {
            const pkg = packages.find(p => p.id === formData.paqueteId);
            if (!pkg) return null;
            const sorted = [...pkg.activities].sort((a, b) => Number(a.day) - Number(b.day));
            return (
              <div className="package-preview">
                <div className="package-preview-header">
                  <span className="package-preview-title">{pkg.activities.length} actividad(es) a programar</span>
                  <span className="package-preview-meta">{pkg.tipoCosecha} · {pkg.etapaCultivo}</span>
                </div>
                <ul className="package-preview-list">
                  {sorted.map((act, i) => {
                    let dateStr = null;
                    if (formData.fechaCreacion) {
                      const base = new Date(formData.fechaCreacion + 'T00:00:00Z');
                      const d = new Date(base.getTime() + Number(act.day) * 86400000);
                      dateStr = d.toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short' });
                    }
                    return (
                      <li key={i} className="package-preview-item">
                        <span className="preview-day">Día {act.day}</span>
                        <span className="preview-name">{act.name}</span>
                        {dateStr && <span className="preview-date">{dateStr}</span>}
                        <span className={`preview-type-badge preview-badge-${act.type || 'notificacion'}`}>
                          {act.type === 'aplicacion' ? 'Aplicación' : 'Notificación'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              <FiPlus />
              {isEditing ? 'Actualizar Lote' : 'Crear y Programar'}
            </button>
            {isEditing && (
              <button type="button" onClick={resetForm} className="btn btn-secondary">
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      {/* --- TARJETA DE LA LISTA --- */}
      <div className="list-card">
        <h2>Lotes Existentes</h2>
        <ul className="info-list">
          {lotes.map(lote => (
            <li key={lote.id}>
              <div>
                <div className="item-main-text">{lote.nombreLote}</div>
                <div className="item-sub-text">Creado: {new Date(lote.fechaCreacion._seconds * 1000).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</div>
              </div>
              <div className="lote-actions">
                <button onClick={() => handleEdit(lote)} className="icon-btn" title="Editar">
                  <FiEdit size={18} />
                </button>
                <button onClick={() => handleDeleteClick(lote)} className="icon-btn delete" title="Eliminar">
                  <FiTrash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {lotes.length === 0 && <p className="empty-state">No hay lotes creados.</p>}
      </div>
    </div>
  );
}

export default LoteManagement;
