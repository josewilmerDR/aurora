import { useState, useEffect, useRef } from 'react';
import { FiPlus, FiEdit, FiTrash2, FiX, FiCheck } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './LoteManagement.css';

const EMPTY_FORM = { id: null, nombre: '' };

function UnidadesMedida() {
  const apiFetch = useApiFetch();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const inputRef = useRef(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchItems = () =>
    apiFetch('/api/unidades-medida')
      .then(r => r.json())
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar las unidades.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => { fetchItems(); }, []);

  useEffect(() => {
    if (showForm) setTimeout(() => inputRef.current?.focus(), 50);
  }, [showForm]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
  };

  const handleEdit = (item) => {
    setForm({ id: item.id, nombre: item.nombre });
    setIsEditing(true);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id, nombre) => {
    if (!window.confirm(`¿Eliminar la unidad "${nombre}"?`)) return;
    try {
      const res = await apiFetch(`/api/unidades-medida/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Unidad eliminada.');
      fetchItems();
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) {
      showToast('El nombre es requerido.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(
        isEditing ? `/api/unidades-medida/${form.id}` : '/api/unidades-medida',
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: form.nombre.trim() }),
        }
      );
      if (!res.ok) throw new Error();
      showToast(isEditing ? 'Unidad actualizada.' : 'Unidad creada.');
      resetForm();
      fetchItems();
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lote-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="lote-header">
        <div>
          <h1 className="lote-title">Unidades de Medida</h1>
          <p className="lote-subtitle">
            Administra las unidades disponibles en los formularios del sistema.
          </p>
        </div>
        {!showForm && (
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            <FiPlus size={16} /> Nueva unidad
          </button>
        )}
      </div>

      {/* ── Formulario ── */}
      {showForm && (
        <div className="form-card" style={{ maxWidth: 480, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
              {isEditing ? 'Editar unidad' : 'Nueva unidad'}
            </h3>
            <button className="icon-btn" onClick={resetForm} title="Cancelar">
              <FiX size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-control">
              <label>Nombre</label>
              <input
                ref={inputRef}
                type="text"
                value={form.nombre}
                onChange={e => setForm(prev => ({ ...prev, nombre: e.target.value }))}
                placeholder="Ej: Kg, Ha, Jornal…"
                maxLength={40}
              />
            </div>
            <div className="form-actions" style={{ marginTop: 14 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} />
                {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Crear'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Lista ── */}
      <div className="form-card">
        {loading ? (
          <p className="empty-state">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="empty-state">No hay unidades registradas. Crea la primera.</p>
        ) : (
          <ul className="lote-list">
            {items.map(item => (
              <li key={item.id} className="lote-item">
                <div className="lote-item-info">
                  <span className="item-main-text">{item.nombre}</span>
                </div>
                <div className="lote-item-actions">
                  <button
                    className="icon-btn"
                    onClick={() => handleEdit(item)}
                    title="Editar"
                  >
                    <FiEdit size={15} />
                  </button>
                  <button
                    className="icon-btn icon-btn--danger"
                    onClick={() => handleDelete(item.id, item.nombre)}
                    title="Eliminar"
                  >
                    <FiTrash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default UnidadesMedida;
