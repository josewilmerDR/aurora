import { useState, useEffect } from 'react';
import { FiPlus, FiTrash2, FiEdit2, FiCheck, FiX } from 'react-icons/fi';
import Toast from '../components/Toast';
import './Siembra.css';

const EMPTY = { nombre: '', rangoPesos: '', variedad: '' };

function SiembraMateriales() {
  const [materiales, setMateriales] = useState([]);
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState({ ...EMPTY });
  const [editingId, setEditingId]   = useState(null);
  const [editData, setEditData]     = useState({ ...EMPTY });
  const [toast, setToast]           = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  useEffect(() => {
    fetch('/api/materiales-siembra').then(r => r.json()).then(setMateriales).catch(console.error);
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) { showToast('El nombre es obligatorio.', 'error'); return; }
    try {
      const res = await fetch('/api/materiales-siembra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const { id } = await res.json();
      setMateriales(prev => [...prev, { id, ...form }].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setForm({ ...EMPTY });
      setShowForm(false);
      showToast('Material creado.');
    } catch {
      showToast('Error al crear material.', 'error');
    }
  };

  const startEdit = (m) => { setEditingId(m.id); setEditData({ nombre: m.nombre, rangoPesos: m.rangoPesos || '', variedad: m.variedad || '' }); };

  const saveEdit = async () => {
    try {
      await fetch(`/api/materiales-siembra/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData),
      });
      setMateriales(prev => prev.map(m => m.id === editingId ? { ...m, ...editData } : m));
      setEditingId(null);
      showToast('Material actualizado.');
    } catch {
      showToast('Error al actualizar.', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este material?')) return;
    try {
      await fetch(`/api/materiales-siembra/${id}`, { method: 'DELETE' });
      setMateriales(prev => prev.filter(m => m.id !== id));
      showToast('Material eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="page-toolbar">
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <FiPlus size={16} /> Nuevo material
        </button>
      </div>

      {showForm && (
        <div className="form-card" style={{ marginBottom: '1rem' }}>
          <p className="form-section-title">Nuevo Material de Siembra</p>
          <form onSubmit={handleCreate} className="lote-form">
            <div className="form-grid">
              <div className="form-control">
                <label>Nombre *</label>
                <input value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej: CM, MD2, Cayena Lisa" autoFocus />
              </div>
              <div className="form-control">
                <label>Rango de pesos</label>
                <input value={form.rangoPesos} onChange={e => setForm(p => ({ ...p, rangoPesos: e.target.value }))} placeholder="Ej: 200g - 300g" />
              </div>
              <div className="form-control">
                <label>Variedad</label>
                <input value={form.variedad} onChange={e => setForm(p => ({ ...p, variedad: e.target.value }))} placeholder="Ej: Amarilla, Roja" />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Crear</button>
              <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setForm({ ...EMPTY }); }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div className="items-list">
        {materiales.length === 0 && (
          <p className="empty-state">No hay materiales registrados. Crea el primero.</p>
        )}
        {materiales.map(m => (
          <div key={m.id} className="item-card">
            <div className="item-card-header">
              {editingId === m.id ? (
                <div className="material-edit-row">
                  <input className="td-input" placeholder="Nombre" value={editData.nombre}
                    onChange={e => setEditData(p => ({ ...p, nombre: e.target.value }))} />
                  <input className="td-input" placeholder="Rango pesos" value={editData.rangoPesos}
                    onChange={e => setEditData(p => ({ ...p, rangoPesos: e.target.value }))} />
                  <input className="td-input" placeholder="Variedad" value={editData.variedad}
                    onChange={e => setEditData(p => ({ ...p, variedad: e.target.value }))} />
                </div>
              ) : (
                <div className="material-info-row">
                  <span className="item-main-text">{m.nombre}</span>
                  {m.rangoPesos && <span className="material-chip">{m.rangoPesos}</span>}
                  {m.variedad   && <span className="material-chip material-chip-var">{m.variedad}</span>}
                </div>
              )}
              <div className="item-actions">
                {editingId === m.id ? (
                  <>
                    <button className="btn-icon btn-success" onClick={saveEdit} title="Guardar"><FiCheck size={16} /></button>
                    <button className="btn-icon" onClick={() => setEditingId(null)} title="Cancelar"><FiX size={16} /></button>
                  </>
                ) : (
                  <>
                    <button className="btn-icon" onClick={() => startEdit(m)} title="Editar"><FiEdit2 size={15} /></button>
                    <button className="btn-icon btn-danger" onClick={() => handleDelete(m.id)} title="Eliminar"><FiTrash2 size={15} /></button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SiembraMateriales;
