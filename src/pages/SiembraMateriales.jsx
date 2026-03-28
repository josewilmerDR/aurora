import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiTrash2, FiEdit2, FiCheck, FiX, FiArrowLeft } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './Siembra.css';

const EMPTY = { nombre: '', rangoPesos: '', variedad: '' };

function SiembraMateriales() {
  const apiFetch = useApiFetch();
  const [materiales, setMateriales] = useState([]);
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState({ ...EMPTY });
  const [editingId, setEditingId]   = useState(null);
  const [editData, setEditData]     = useState({ ...EMPTY });
  const [toast, setToast]           = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  useEffect(() => {
    apiFetch('/api/materiales-siembra').then(r => r.json()).then(setMateriales).catch(console.error);
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) { showToast('El nombre es obligatorio.', 'error'); return; }
    try {
      const res = await apiFetch('/api/materiales-siembra', {
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

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditData({ nombre: m.nombre, rangoPesos: m.rangoPesos || '', variedad: m.variedad || '' });
  };

  const saveEdit = async () => {
    try {
      await apiFetch(`/api/materiales-siembra/${editingId}`, {
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
      await apiFetch(`/api/materiales-siembra/${id}`, { method: 'DELETE' });
      setMateriales(prev => prev.filter(m => m.id !== id));
      showToast('Material eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  return (
    <div className="sm-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Header ── */}
      <div className="sm-header">
        <Link to="/siembra" className="btn btn-secondary">
          <FiArrowLeft size={15} /> Volver al registro
        </Link>
        <div className="sm-title-block">
          <h2 className="sm-title">Materiales de Siembra</h2>
          {materiales.length > 0 && (
            <span className="sm-count">{materiales.length}</span>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)} disabled={showForm}>
          <FiPlus size={15} /> Nuevo material
        </button>
      </div>

      {/* ── Formulario creación ── */}
      {showForm && (
        <div className="sm-form-card">
          <div className="sm-form-header">
            <span>Nuevo material</span>
            <button className="sm-close-btn" onClick={() => { setShowForm(false); setForm({ ...EMPTY }); }}>
              <FiX size={15} />
            </button>
          </div>
          <form onSubmit={handleCreate} className="sm-form">
            <div className="sm-form-grid">
              <div className="sm-field">
                <label>Nombre <span className="sm-required">*</span></label>
                <input
                  value={form.nombre}
                  onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Ej: CM, MD2, Cayena Lisa"
                  autoFocus
                />
              </div>
              <div className="sm-field">
                <label>Rango de pesos</label>
                <input
                  value={form.rangoPesos}
                  onChange={e => setForm(p => ({ ...p, rangoPesos: e.target.value }))}
                  placeholder="Ej: 200g – 300g"
                />
              </div>
              <div className="sm-field">
                <label>Variedad</label>
                <input
                  value={form.variedad}
                  onChange={e => setForm(p => ({ ...p, variedad: e.target.value }))}
                  placeholder="Ej: Amarilla, Roja"
                />
              </div>
            </div>
            <div className="sm-form-actions">
              <button type="button" className="btn btn-secondary"
                onClick={() => { setShowForm(false); setForm({ ...EMPTY }); }}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary">Crear material</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Lista ── */}
      <div className="sm-list">
        {materiales.length === 0 && (
          <div className="sm-empty">
            <p>No hay materiales registrados.</p>
            <p className="sm-empty-hint">Crea el primero con el botón "Nuevo material".</p>
          </div>
        )}
        {materiales.map(m => (
          <div key={m.id} className={`sm-item${editingId === m.id ? ' sm-item--editing' : ''}`}>
            {editingId === m.id ? (
              <div className="sm-item-edit">
                <input className="sm-edit-input" placeholder="Nombre"
                  value={editData.nombre}
                  onChange={e => setEditData(p => ({ ...p, nombre: e.target.value }))} />
                <input className="sm-edit-input" placeholder="Rango de pesos"
                  value={editData.rangoPesos}
                  onChange={e => setEditData(p => ({ ...p, rangoPesos: e.target.value }))} />
                <input className="sm-edit-input" placeholder="Variedad"
                  value={editData.variedad}
                  onChange={e => setEditData(p => ({ ...p, variedad: e.target.value }))} />
                <div className="sm-item-actions">
                  <button className="sm-btn-icon sm-btn-success" onClick={saveEdit} title="Guardar">
                    <FiCheck size={15} />
                  </button>
                  <button className="sm-btn-icon" onClick={() => setEditingId(null)} title="Cancelar">
                    <FiX size={15} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="sm-item-view">
                <div className="sm-item-info">
                  <span className="sm-item-name">{m.nombre}</span>
                  <div className="sm-item-chips">
                    {m.rangoPesos && <span className="material-chip">{m.rangoPesos}</span>}
                    {m.variedad   && <span className="material-chip material-chip-var">{m.variedad}</span>}
                  </div>
                </div>
                <div className="sm-item-actions">
                  <button className="sm-btn-icon" onClick={() => startEdit(m)} title="Editar">
                    <FiEdit2 size={15} />
                  </button>
                  <button className="sm-btn-icon sm-btn-danger" onClick={() => handleDelete(m.id)} title="Eliminar">
                    <FiTrash2 size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default SiembraMateriales;
