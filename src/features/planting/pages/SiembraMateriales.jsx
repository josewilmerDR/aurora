import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiTrash2, FiEdit2, FiCheck, FiX } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/siembra-materiales.css';

const EMPTY = { nombre: '', rangoPesos: '', variedad: '' };

function SiembraMateriales() {
  const apiFetch = useApiFetch();
  const [materiales, setMateriales] = useState([]);
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState({ ...EMPTY });
  const [editingId, setEditingId]   = useState(null);
  const [editData, setEditData]     = useState({ ...EMPTY });
  const [toast, setToast]           = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
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

  const askDelete = (m) => {
    setConfirmModal({
      danger: true,
      title: '¿Eliminar este material?',
      body: `"${m.nombre}" se quitará del catálogo. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      onConfirm: () => doDelete(m.id),
    });
  };

  const doDelete = async (id) => {
    setConfirmModal(null);
    try {
      await apiFetch(`/api/materiales-siembra/${id}`, { method: 'DELETE' });
      setMateriales(prev => prev.filter(m => m.id !== id));
      showToast('Material eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const cancelCreate = () => {
    setShowForm(false);
    setForm({ ...EMPTY });
  };

  return (
    <div className="aur-sheet mat-sheet">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && <AuroraConfirmModal {...confirmModal} onCancel={() => setConfirmModal(null)} />}

      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title">Materiales de siembra</h2>
          <p className="aur-sheet-subtitle">Catálogo de variedades y rangos de peso usados en los registros.</p>
        </div>
        <div className="aur-sheet-header-actions">
          <Link to="/siembra" className="aur-chip">
            Volver
          </Link>
          {!showForm && (
            <button type="button" className="aur-chip mat-chip-add" onClick={() => setShowForm(true)}>
              <FiPlus size={12} /> Nuevo material
            </button>
          )}
        </div>
      </header>

      {showForm && (
        <section className="aur-section">
          <div className="aur-section-header">
            <h3>Nuevo material</h3>
            <div className="aur-section-actions">
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--sm"
                onClick={cancelCreate}
                title="Cerrar"
                aria-label="Cerrar"
              >
                <FiX size={14} />
              </button>
            </div>
          </div>
          <form onSubmit={handleCreate}>
            <div className="aur-list">
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="mat-nombre">
                  Nombre <span className="mat-required">*</span>
                </label>
                <input
                  id="mat-nombre"
                  className="aur-input"
                  value={form.nombre}
                  onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Ej. CM, MD2, Cayena Lisa"
                  autoFocus
                />
              </div>
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="mat-rango">Rango de pesos</label>
                <input
                  id="mat-rango"
                  className="aur-input"
                  value={form.rangoPesos}
                  onChange={e => setForm(p => ({ ...p, rangoPesos: e.target.value }))}
                  placeholder="Ej. 200g – 300g"
                />
              </div>
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="mat-variedad">Variedad</label>
                <input
                  id="mat-variedad"
                  className="aur-input"
                  value={form.variedad}
                  onChange={e => setForm(p => ({ ...p, variedad: e.target.value }))}
                  placeholder="Ej. Amarilla, Roja"
                />
              </div>
            </div>
            <div className="mat-form-actions">
              <button type="button" className="aur-btn-text" onClick={cancelCreate}>Cancelar</button>
              <button type="submit" className="aur-btn-pill">Crear material</button>
            </div>
          </form>
        </section>
      )}

      <section className="aur-section">
        {materiales.length === 0 ? (
          <div className="mat-empty">
            <p>No hay materiales registrados.</p>
            <p className="mat-empty-hint">Crea el primero con el botón "Nuevo material".</p>
          </div>
        ) : (
          <ul className="mat-list">
            {materiales.map(m => (
              <li key={m.id} className={`mat-card${editingId === m.id ? ' mat-card--editing' : ''}`}>
                {editingId === m.id ? (
                  <>
                    <div className="mat-edit">
                      <input
                        className="aur-input"
                        placeholder="Nombre"
                        value={editData.nombre}
                        onChange={e => setEditData(p => ({ ...p, nombre: e.target.value }))}
                      />
                      <input
                        className="aur-input"
                        placeholder="Rango de pesos"
                        value={editData.rangoPesos}
                        onChange={e => setEditData(p => ({ ...p, rangoPesos: e.target.value }))}
                      />
                      <input
                        className="aur-input"
                        placeholder="Variedad"
                        value={editData.variedad}
                        onChange={e => setEditData(p => ({ ...p, variedad: e.target.value }))}
                      />
                    </div>
                    <div className="mat-actions">
                      <button type="button" className="aur-icon-btn aur-icon-btn--success" onClick={saveEdit} title="Guardar">
                        <FiCheck size={14} />
                      </button>
                      <button type="button" className="aur-icon-btn" onClick={() => setEditingId(null)} title="Cancelar">
                        <FiX size={14} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mat-info">
                      <span className="mat-name">{m.nombre}</span>
                      {(m.rangoPesos || m.variedad) && (
                        <div className="mat-chips">
                          {m.rangoPesos && <span className="aur-chip">{m.rangoPesos}</span>}
                          {m.variedad && <span className="aur-chip aur-chip--ghost">{m.variedad}</span>}
                        </div>
                      )}
                    </div>
                    <div className="mat-actions">
                      <button type="button" className="aur-icon-btn" onClick={() => startEdit(m)} title="Editar">
                        <FiEdit2 size={14} />
                      </button>
                      <button type="button" className="aur-icon-btn aur-icon-btn--danger" onClick={() => askDelete(m)} title="Eliminar">
                        <FiTrash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default SiembraMateriales;
