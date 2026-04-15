import { useState, useEffect } from 'react';
import { FiList, FiEdit, FiTrash2, FiPlus, FiX, FiCheck } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './LaborList.css';

const EMPTY_FORM = {
  id: null,
  codigo: '',
  descripcion: '',
  observacion: '',
};

const MAX_CODIGO = 30;
const MAX_DESCRIPCION = 200;
const MAX_OBSERVACION = 1000;

function LaborList() {
  const apiFetch = useApiFetch();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('');
  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchItems = () =>
    apiFetch('/api/labores')
      .then(r => r.json())
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar la lista de labores.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => { fetchItems(); }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
  };

  const handleEdit = (item) => {
    setForm({
      id: item.id ?? null,
      codigo: item.codigo ?? '',
      descripcion: item.descripcion ?? '',
      observacion: item.observacion ?? '',
    });
    setIsEditing(true);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNew = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(true);
  };

  const handleDelete = async (id, descripcion) => {
    if (!window.confirm(`¿Eliminar "${descripcion}"?`)) return;
    try {
      const res = await apiFetch(`/api/labores/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Labor eliminada.');
      fetchItems();
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      codigo: form.codigo.trim().slice(0, MAX_CODIGO),
      descripcion: form.descripcion.trim().slice(0, MAX_DESCRIPCION),
      observacion: form.observacion.trim().slice(0, MAX_OBSERVACION),
    };
    if (!payload.descripcion) {
      showToast('La descripción es obligatoria.', 'error');
      return;
    }
    setSaving(true);
    try {
      const url = isEditing ? `/api/labores/${form.id}` : '/api/labores';
      const method = isEditing ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      showToast(isEditing ? 'Labor actualizada.' : 'Labor registrada.');
      resetForm();
      fetchItems();
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const q = filter.toLowerCase();
  const filtered = items.filter(item =>
    !q ||
    item.descripcion?.toLowerCase().includes(q) ||
    item.codigo?.toLowerCase().includes(q)
  );

  return (
    <div className="lab-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {!showForm ? (
        <div className="lab-toolbar">
          <input
            className="lab-search"
            placeholder="Buscar por descripción o código…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button className="btn btn-primary" onClick={handleNew}>
            <FiPlus size={15} /> Nueva Labor
          </button>
        </div>
      ) : (
        <div className="lab-form-card">
          <div className="lab-form-header">
            <span>{isEditing ? 'Editar Labor' : 'Nueva Labor'}</span>
            <button className="lab-close-btn" onClick={resetForm} title="Cancelar">
              <FiX size={16} />
            </button>
          </div>

          <form className="lab-form" onSubmit={handleSubmit}>
            <div className="lab-form-grid">
              <div className="lab-field">
                <label>Código</label>
                <input
                  name="codigo"
                  value={form.codigo}
                  onChange={handleChange}
                  placeholder="Ej. CHAP-01"
                  maxLength={MAX_CODIGO}
                />
              </div>

              <div className="lab-field">
                <label>Descripción <span className="lab-required">*</span></label>
                <input
                  name="descripcion"
                  value={form.descripcion}
                  onChange={handleChange}
                  placeholder="Nombre de la labor"
                  maxLength={MAX_DESCRIPCION}
                  required
                />
              </div>

              <div className="lab-field lab-field--full">
                <label>Observación</label>
                <textarea
                  name="observacion"
                  value={form.observacion}
                  onChange={handleChange}
                  placeholder="Notas adicionales sobre esta labor…"
                  rows={2}
                  maxLength={MAX_OBSERVACION}
                />
              </div>
            </div>

            <div className="lab-form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Registrar'}
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="lab-section">
        <div className="lab-section-header">
          <FiList size={14} />
          <span>Labores registradas</span>
          {items.length > 0 && <span className="lab-count">{items.length}</span>}
        </div>

        {loading ? (
          <p className="lab-empty">Cargando…</p>
        ) : filtered.length === 0 ? (
          <div className="lab-empty-state">
            <FiList size={32} />
            <p>{items.length === 0 ? 'No hay labores registradas.' : 'Sin resultados para la búsqueda.'}</p>
            {items.length === 0 && (
              <button className="btn btn-primary" onClick={handleNew}>
                <FiPlus size={14} /> Agregar la primera
              </button>
            )}
          </div>
        ) : (
          <div className="lab-table-wrap">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Observación</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id}>
                    <td className="lab-td-code">{item.codigo || <span className="lab-td-empty">—</span>}</td>
                    <td className="lab-td-desc">{item.descripcion}</td>
                    <td className="lab-td-obs">{item.observacion || <span className="lab-td-empty">—</span>}</td>
                    <td className="lab-td-actions">
                      <button className="lab-btn-icon" onClick={() => handleEdit(item)} title="Editar">
                        <FiEdit size={13} />
                      </button>
                      <button className="lab-btn-icon lab-btn-danger" onClick={() => handleDelete(item.id, item.descripcion)} title="Eliminar">
                        <FiTrash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default LaborList;
