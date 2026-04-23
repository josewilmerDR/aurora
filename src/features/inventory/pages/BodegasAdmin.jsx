import { useState, useEffect } from 'react';
import { FiBox, FiTool, FiTruck, FiDroplet, FiPackage, FiEdit2, FiTrash2, FiPlus, FiX, FiCheck } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import ConfirmModal from '../../../components/ConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/bodegas-admin.css';

const ICONOS = [
  { key: 'FiBox',     Icon: FiBox,     label: 'Caja'        },
  { key: 'FiTool',    Icon: FiTool,    label: 'Herramienta' },
  { key: 'FiTruck',   Icon: FiTruck,   label: 'Camión'      },
  { key: 'FiDroplet', Icon: FiDroplet, label: 'Líquido'     },
  { key: 'FiPackage', Icon: FiPackage, label: 'Paquete'     },
];

const EMPTY_FORM = { nombre: '', icono: 'FiBox' };

function BodegasAdmin() {
  const apiFetch = useApiFetch();
  const [bodegas, setBodegas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchBodegas = () => {
    apiFetch('/api/bodegas')
      .then(r => r.json())
      .then(data => setBodegas(data.filter(b => b.tipo !== 'agroquimicos')))
      .catch(() => showToast('Error al cargar bodegas.', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchBodegas(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (b) => {
    setEditingId(b.id);
    setForm({ nombre: b.nombre, icono: b.icono || 'FiBox' });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.nombre.trim()) { showToast('El nombre es requerido.', 'error'); return; }
    setSaving(true);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/bodegas/${editingId}` : '/api/bodegas';
      const res = await apiFetch(url, { method, body: JSON.stringify(form) });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.message || 'Error al guardar.', 'error');
        return;
      }
      showToast(editingId ? 'Bodega actualizada.' : 'Bodega creada.');
      closeForm();
      fetchBodegas();
      // Notificar al sidebar para que recargue
      window.dispatchEvent(new CustomEvent('aurora-bodegas-changed'));
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (b) => {
    try {
      const res = await apiFetch(`/api/bodegas/${b.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.message, 'error');
        return;
      }
      showToast('Bodega eliminada.');
      fetchBodegas();
      window.dispatchEvent(new CustomEvent('aurora-bodegas-changed'));
    } catch {
      showToast('Error de conexión.', 'error');
    }
  };

  const IconComp = ({ iconKey, size = 20 }) => {
    const found = ICONOS.find(i => i.key === iconKey);
    if (!found) return <FiBox size={size} />;
    const { Icon } = found;
    return <Icon size={size} />;
  };

  return (
    <div className="lm-container">
      {loading ? (
        <div className="lm-loading" />
      ) : bodegas.length === 0 ? (
        <div className="ba-empty-state">
          <FiBox size={36} />
          <p>No hay bodegas adicionales configuradas.</p>
          <button className="lm-btn-primary" onClick={openCreate}>
            <FiPlus size={14} /> Crear bodega adicional
          </button>
        </div>
      ) : (
        <>
          <div className="lm-header">
            <div className="lm-header-left">
              <h2 className="lm-title">Bodegas Adicionales</h2>
              <p className="lm-subtitle">
                Crea y gestiona almacenes secundarios de la finca u organización
              </p>
            </div>
            <button className="lm-btn-primary" onClick={openCreate}>
              <FiPlus size={16} /> Nueva Bodega
            </button>
          </div>
          <div className="ba-grid">
            {bodegas.map(b => {
              const esSistema = b.tipo === 'combustibles';
              return (
                <div key={b.id} className={`ba-card${esSistema ? ' ba-card--sistema' : ''}`}>
                  <div className="ba-card-icon">
                    <IconComp iconKey={b.icono} size={28} />
                  </div>
                  <div className="ba-card-body">
                    <span className="ba-card-name">{b.nombre}</span>
                    {esSistema && <span className="ba-card-sistema-badge">Sistema</span>}
                  </div>
                  {!esSistema && (
                    <div className="ba-card-actions">
                      <button className="ba-btn-icon" onClick={() => openEdit(b)} title="Editar">
                        <FiEdit2 size={15} />
                      </button>
                      <button className="ba-btn-icon ba-btn-danger" onClick={() => setConfirmDelete(b)} title="Eliminar">
                        <FiTrash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modal crear/editar */}
      {showForm && (
        <div className="lm-modal-backdrop" onClick={closeForm}>
          <div className="lm-modal" onClick={e => e.stopPropagation()}>
            <div className="lm-modal-header">
              <h3>{editingId ? 'Editar Bodega' : 'Nueva Bodega'}</h3>
              <button className="lm-modal-close" onClick={closeForm}><FiX size={18} /></button>
            </div>
            <div className="lm-modal-body">
              <label className="lm-label">Nombre *</label>
              <input
                className="lm-input"
                value={form.nombre}
                onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Bodega de Combustibles"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />

              <label className="lm-label" style={{ marginTop: '1.2rem' }}>Ícono</label>
              <div className="ba-icon-picker">
                {ICONOS.map(({ key, Icon, label }) => (
                  <button
                    key={key}
                    className={`ba-icon-option${form.icono === key ? ' selected' : ''}`}
                    onClick={() => setForm(f => ({ ...f, icono: key }))}
                    title={label}
                    type="button"
                  >
                    <Icon size={22} />
                    <span>{label}</span>
                    {form.icono === key && <FiCheck size={12} className="ba-icon-check" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="lm-modal-footer">
              <button className="lm-btn-secondary" onClick={closeForm} disabled={saving}>Cancelar</button>
              <button className="lm-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando...' : (editingId ? 'Guardar cambios' : 'Crear bodega')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Eliminar bodega"
          message={`¿Eliminar la bodega "${confirmDelete.nombre}"? Solo es posible si no tiene productos registrados.`}
          onConfirm={() => { handleDelete(confirmDelete); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default BodegasAdmin;
