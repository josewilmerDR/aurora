import { useState, useEffect, useCallback } from 'react';
import { FiPlus, FiUsers } from 'react-icons/fi';
import Toast from '../../components/Toast';
import ConfirmModal from '../../components/ConfirmModal';
import BuyerForm from '../../components/finance/BuyerForm';
import BuyerRow from '../../components/finance/BuyerRow';
import { useApiFetch } from '../../hooks/useApiFetch';
import './finance.css';

function BuyersList() {
  const apiFetch = useApiFetch();
  const [buyers, setBuyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/buyers')
      .then(r => r.json())
      .then(data => setBuyers(Array.isArray(data) ? data : []))
      .catch(() => setToast({ type: 'error', message: 'No se pudo cargar la lista.' }))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    setSaving(true);
    const isEdit = Boolean(form.id);
    const url = isEdit ? `/api/buyers/${form.id}` : '/api/buyers';
    const method = isEdit ? 'PUT' : 'POST';
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al guardar.');
      }
      setToast({ type: 'success', message: isEdit ? 'Comprador actualizado.' : 'Comprador creado.' });
      setShowForm(false);
      setEditing(null);
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await apiFetch(`/api/buyers/${confirmDelete}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar.');
      setToast({ type: 'success', message: 'Comprador eliminado.' });
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setConfirmDelete(null);
    }
  };

  const startEdit = (buyer) => { setEditing(buyer); setShowForm(true); };
  const startCreate = () => { setEditing(null); setShowForm(true); };
  const cancel = () => { setShowForm(false); setEditing(null); };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiUsers /> Compradores</h2>
        {!showForm && (
          <button className="btn-primary" onClick={startCreate}>
            <FiPlus /> Nuevo comprador
          </button>
        )}
      </div>

      {showForm && (
        <BuyerForm
          initial={editing}
          onSubmit={handleSave}
          onCancel={cancel}
          saving={saving}
        />
      )}

      {loading ? (
        <p className="finance-empty">Cargando…</p>
      ) : buyers.length === 0 ? (
        <p className="finance-empty">Aún no hay compradores registrados.</p>
      ) : (
        <div className="lote-list">
          {buyers.map(b => (
            <BuyerRow key={b.id} buyer={b} onEdit={startEdit} onDelete={setConfirmDelete} />
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Eliminar comprador"
          message="Esta acción no se puede deshacer."
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

export default BuyersList;
