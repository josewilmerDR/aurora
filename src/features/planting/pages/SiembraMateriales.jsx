import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiTrash2, FiEdit2, FiCheck, FiX, FiArrowLeft } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/siembra.css';

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
    <div className="sm-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && <AuroraConfirmModal {...confirmModal} onCancel={() => setConfirmModal(null)} />}

      <div className="sm-page">
        <header className="sm-page-header">
          <div className="sm-page-header-text">
            <h2 className="sm-page-title">Materiales de siembra</h2>
            <p className="sm-page-subtitle">Catálogo de variedades y rangos de peso usados en los registros.</p>
          </div>
          <div className="sm-page-header-actions">
            <Link to="/siembra" className="sm-chip sm-chip--ghost">
              <FiArrowLeft size={12} /> Registro
            </Link>
            {!showForm && (
              <button type="button" className="sm-btn-pill" onClick={() => setShowForm(true)}>
                <FiPlus size={14} /> Nuevo material
              </button>
            )}
          </div>
        </header>

        {showForm && (
          <section className="sm-page-section">
            <div className="sm-page-section-header">
              <span className="sm-page-section-num">+</span>
              <h3>Nuevo material</h3>
              <button type="button" className="sm-page-section-close" onClick={cancelCreate} title="Cerrar">
                <FiX size={14} />
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="sm-page-form-list">
                <div className="sm-page-form-row">
                  <label htmlFor="sm-nombre">Nombre <span className="sm-required">*</span></label>
                  <input
                    id="sm-nombre"
                    value={form.nombre}
                    onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                    placeholder="Ej. CM, MD2, Cayena Lisa"
                    autoFocus
                  />
                </div>
                <div className="sm-page-form-row">
                  <label htmlFor="sm-rango">Rango de pesos</label>
                  <input
                    id="sm-rango"
                    value={form.rangoPesos}
                    onChange={e => setForm(p => ({ ...p, rangoPesos: e.target.value }))}
                    placeholder="Ej. 200g – 300g"
                  />
                </div>
                <div className="sm-page-form-row">
                  <label htmlFor="sm-variedad">Variedad</label>
                  <input
                    id="sm-variedad"
                    value={form.variedad}
                    onChange={e => setForm(p => ({ ...p, variedad: e.target.value }))}
                    placeholder="Ej. Amarilla, Roja"
                  />
                </div>
              </div>
              <div className="sm-page-form-actions">
                <button type="button" className="sm-btn-text" onClick={cancelCreate}>Cancelar</button>
                <button type="submit" className="sm-btn-pill">Crear material</button>
              </div>
            </form>
          </section>
        )}

        <section className="sm-page-section">
          <div className="sm-page-section-header">
            <span className="sm-page-section-num">{showForm ? '02' : '01'}</span>
            <h3>Catálogo</h3>
            <span className="sm-page-section-count">{materiales.length}</span>
          </div>

          {materiales.length === 0 ? (
            <div className="sm-empty">
              <p>No hay materiales registrados.</p>
              <p className="sm-empty-hint">Crea el primero con el botón "Nuevo material".</p>
            </div>
          ) : (
            <ul className="sm-item-list">
              {materiales.map(m => (
                <li key={m.id} className={`sm-item-card${editingId === m.id ? ' sm-item-card--editing' : ''}`}>
                  {editingId === m.id ? (
                    <>
                      <div className="sm-item-edit">
                        <input
                          className="sm-item-input"
                          placeholder="Nombre"
                          value={editData.nombre}
                          onChange={e => setEditData(p => ({ ...p, nombre: e.target.value }))}
                        />
                        <input
                          className="sm-item-input"
                          placeholder="Rango de pesos"
                          value={editData.rangoPesos}
                          onChange={e => setEditData(p => ({ ...p, rangoPesos: e.target.value }))}
                        />
                        <input
                          className="sm-item-input"
                          placeholder="Variedad"
                          value={editData.variedad}
                          onChange={e => setEditData(p => ({ ...p, variedad: e.target.value }))}
                        />
                      </div>
                      <div className="sm-item-actions">
                        <button type="button" className="sm-icon-btn sm-icon-btn--success" onClick={saveEdit} title="Guardar">
                          <FiCheck size={14} />
                        </button>
                        <button type="button" className="sm-icon-btn" onClick={() => setEditingId(null)} title="Cancelar">
                          <FiX size={14} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="sm-item-info">
                        <span className="sm-item-name">{m.nombre}</span>
                        {(m.rangoPesos || m.variedad) && (
                          <div className="sm-item-chips">
                            {m.rangoPesos && <span className="sm-mat-chip">{m.rangoPesos}</span>}
                            {m.variedad && <span className="sm-mat-chip sm-mat-chip--var">{m.variedad}</span>}
                          </div>
                        )}
                      </div>
                      <div className="sm-item-actions">
                        <button type="button" className="sm-icon-btn" onClick={() => startEdit(m)} title="Editar">
                          <FiEdit2 size={14} />
                        </button>
                        <button type="button" className="sm-icon-btn sm-icon-btn--danger" onClick={() => askDelete(m)} title="Eliminar">
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
    </div>
  );
}

export default SiembraMateriales;
