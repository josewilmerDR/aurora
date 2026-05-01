import { useState, useEffect } from 'react';
import { FiList, FiEdit, FiTrash2, FiPlus, FiX, FiCheck, FiSearch } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/labor-list.css';

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
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, descripcion }
  const [deleting, setDeleting] = useState(false);
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

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/labores/${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Labor eliminada.');
      setConfirmDelete(null);
      fetchItems();
    } catch {
      showToast('Error al eliminar.', 'error');
    } finally {
      setDeleting(false);
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
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title={`¿Eliminar "${confirmDelete.descripcion}"?`}
          body="Esta acción no se puede deshacer. La labor desaparecerá de los registros y de las unidades de medida que la referencian."
          confirmLabel="Eliminar"
          loading={deleting}
          loadingLabel="Eliminando…"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h2 className="aur-sheet-title">Labores</h2>
            <p className="aur-sheet-subtitle">
              Tipos de trabajo registrables en horímetro y actividades de campo.
            </p>
          </div>
          {!showForm && (
            <div className="aur-sheet-header-actions">
              <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleNew}>
                <FiPlus size={14} /> Nueva labor
              </button>
            </div>
          )}
        </header>

        {showForm && (
          <section className="aur-section">
            <div className="aur-section-header">
              <h3>{isEditing ? 'Editar labor' : 'Nueva labor'}</h3>
              <div className="aur-section-actions">
                <button type="button" className="aur-icon-btn aur-icon-btn--sm" onClick={resetForm} title="Cancelar">
                  <FiX size={14} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="lab-codigo">Código</label>
                  <div className="aur-field">
                    <input
                      id="lab-codigo"
                      className="aur-input"
                      name="codigo"
                      value={form.codigo}
                      onChange={handleChange}
                      placeholder="Ej. CHAP-01"
                      maxLength={MAX_CODIGO}
                    />
                  </div>
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="lab-descripcion">
                    Descripción <span className="lab-required">*</span>
                  </label>
                  <div className="aur-field">
                    <input
                      id="lab-descripcion"
                      className="aur-input"
                      name="descripcion"
                      value={form.descripcion}
                      onChange={handleChange}
                      placeholder="Nombre de la labor"
                      maxLength={MAX_DESCRIPCION}
                      required
                    />
                  </div>
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="lab-observacion">Observación</label>
                  <div className="aur-field">
                    <textarea
                      id="lab-observacion"
                      className="aur-textarea"
                      name="observacion"
                      value={form.observacion}
                      onChange={handleChange}
                      placeholder="Notas adicionales sobre esta labor…"
                      rows={2}
                      maxLength={MAX_OBSERVACION}
                    />
                  </div>
                </div>
              </div>

              <div className="aur-form-actions">
                <button type="button" className="aur-btn-text" onClick={resetForm}>
                  Cancelar
                </button>
                <button type="submit" className="aur-btn-pill aur-btn-pill--sm" disabled={saving}>
                  <FiCheck size={14} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Registrar'}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num">{showForm ? '02' : '01'}</span>
            <h3>Labores registradas</h3>
            {items.length > 0 && <span className="aur-section-count">{items.length}</span>}
          </div>

          <div className="aur-table-toolbar">
            <div className="lab-search-wrap">
              <FiSearch size={13} className="lab-search-icon" />
              <input
                type="search"
                className="aur-input lab-search"
                placeholder="Buscar por descripción o código…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
            <span className="aur-table-result-count">
              {filtered.length} de {items.length}
            </span>
          </div>

          {loading ? (
            <p className="lab-empty">Cargando…</p>
          ) : filtered.length === 0 ? (
            <div className="lab-empty-state">
              <FiList size={32} />
              <p>{items.length === 0 ? 'No hay labores registradas.' : 'Sin resultados para la búsqueda.'}</p>
              {items.length === 0 && !showForm && (
                <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleNew}>
                  <FiPlus size={14} /> Agregar la primera
                </button>
              )}
            </div>
          ) : (
            <div className="aur-table-wrap">
              <table className="aur-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descripción</th>
                    <th>Observación</th>
                    <th className="lab-th-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => (
                    <tr key={item.id}>
                      <td className="lab-td-code">{item.codigo || <span className="lab-td-empty">—</span>}</td>
                      <td className="lab-td-desc">{item.descripcion}</td>
                      <td className="lab-td-obs">{item.observacion || <span className="lab-td-empty">—</span>}</td>
                      <td className="lab-td-actions">
                        <button
                          type="button"
                          className="aur-icon-btn aur-icon-btn--sm"
                          onClick={() => handleEdit(item)}
                          title="Editar"
                        >
                          <FiEdit size={13} />
                        </button>
                        <button
                          type="button"
                          className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                          onClick={() => setConfirmDelete({ id: item.id, descripcion: item.descripcion })}
                          title="Eliminar"
                        >
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
    </>
  );
}

export default LaborList;
