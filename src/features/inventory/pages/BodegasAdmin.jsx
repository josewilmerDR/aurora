import { useState, useEffect } from 'react';
import { FiBox, FiTool, FiTruck, FiDroplet, FiPackage, FiEdit2, FiTrash2, FiPlus, FiX, FiCheck } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
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
      .then(data => setBodegas(data.filter(b => b.tipo === 'generica')))
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
        <div className="aur-page-loading" />
      ) : bodegas.length === 0 ? (
        <div className="ba-empty-state">
          <FiBox size={36} />
          <p>No hay bodegas adicionales configuradas.</p>
          <button className="aur-btn-pill" onClick={openCreate}>
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
            <button className="aur-btn-pill" onClick={openCreate}>
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
        <div className="aur-modal-backdrop" onPointerDown={closeForm}>
          <div className="aur-modal aur-modal--wide" onPointerDown={e => e.stopPropagation()}>
            <header className="aur-modal-header">
              <h2 className="aur-modal-title">{editingId ? 'Editar Bodega' : 'Nueva Bodega'}</h2>
              <button className="aur-icon-btn aur-icon-btn--sm aur-modal-close" onClick={closeForm}>
                <FiX size={16} />
              </button>
            </header>
            <div className="aur-modal-content">
              <div className="aur-field">
                <label className="aur-field-label" htmlFor="bodega-nombre">Nombre</label>
                <input
                  id="bodega-nombre"
                  className="aur-input"
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Bodega de Combustibles"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                />
              </div>

              <div className="aur-field">
                <label className="aur-field-label">Ícono</label>
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
            </div>
            <div className="aur-modal-actions">
              <button className="aur-btn-text" onClick={closeForm} disabled={saving}>Cancelar</button>
              <button className="aur-btn-pill" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando…' : (editingId ? 'Guardar cambios' : 'Crear bodega')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar bodega"
          body={`¿Eliminar la bodega "${confirmDelete.nombre}"? Solo es posible si no tiene productos registrados.`}
          confirmLabel="Eliminar"
          onConfirm={() => { handleDelete(confirmDelete); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default BodegasAdmin;
