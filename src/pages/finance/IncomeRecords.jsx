import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiPlus, FiDollarSign } from 'react-icons/fi';
import Toast from '../../components/Toast';
import ConfirmModal from '../../components/ConfirmModal';
import IncomeForm from '../../components/finance/IncomeForm';
import IncomeRow from '../../components/finance/IncomeRow';
import { useApiFetch } from '../../hooks/useApiFetch';
import './finance.css';

function IncomeRecords() {
  const apiFetch = useApiFetch();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [filters, setFilters] = useState({ from: '', to: '', status: '' });

  const queryString = useMemo(() => {
    const qs = new URLSearchParams();
    if (filters.from) qs.set('from', filters.from);
    if (filters.to) qs.set('to', filters.to);
    if (filters.status) qs.set('status', filters.status);
    const s = qs.toString();
    return s ? `?${s}` : '';
  }, [filters]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/income${queryString}`)
      .then(r => r.json())
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(() => setToast({ type: 'error', message: 'No se pudo cargar el historial.' }))
      .finally(() => setLoading(false));
  }, [apiFetch, queryString]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (payload) => {
    setSaving(true);
    const isEdit = Boolean(payload.id);
    const url = isEdit ? `/api/income/${payload.id}` : '/api/income';
    const method = isEdit ? 'PUT' : 'POST';
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al guardar.');
      }
      setToast({ type: 'success', message: isEdit ? 'Ingreso actualizado.' : 'Ingreso registrado.' });
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
      const res = await apiFetch(`/api/income/${confirmDelete}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar.');
      setToast({ type: 'success', message: 'Ingreso eliminado.' });
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setConfirmDelete(null);
    }
  };

  const startEdit = (record) => { setEditing(record); setShowForm(true); };
  const startCreate = () => { setEditing(null); setShowForm(true); };
  const cancel = () => { setShowForm(false); setEditing(null); };
  const updateFilter = (field) => (e) => setFilters(prev => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiDollarSign /> Ingresos</h2>
        {!showForm && (
          <button className="btn-primary" onClick={startCreate}>
            <FiPlus /> Nuevo ingreso
          </button>
        )}
      </div>

      {showForm && (
        <IncomeForm
          initial={editing}
          onSubmit={handleSave}
          onCancel={cancel}
          saving={saving}
        />
      )}

      {!showForm && (
        <div className="finance-filters">
          <div className="finance-field">
            <label>Desde</label>
            <input type="date" value={filters.from} onChange={updateFilter('from')} />
          </div>
          <div className="finance-field">
            <label>Hasta</label>
            <input type="date" value={filters.to} onChange={updateFilter('to')} />
          </div>
          <div className="finance-field">
            <label>Estado</label>
            <select value={filters.status} onChange={updateFilter('status')}>
              <option value="">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="cobrado">Cobrado</option>
              <option value="anulado">Anulado</option>
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <p className="finance-empty">Cargando…</p>
      ) : records.length === 0 ? (
        <p className="finance-empty">No hay ingresos registrados para el filtro actual.</p>
      ) : (
        <div className="lote-list">
          {records.map(r => (
            <IncomeRow key={r.id} record={r} onEdit={startEdit} onDelete={setConfirmDelete} />
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Eliminar ingreso"
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

export default IncomeRecords;
