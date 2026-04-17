import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiPlus, FiDollarSign } from 'react-icons/fi';
import Toast from '../../components/Toast';
import ConfirmModal from '../../components/ConfirmModal';
import BudgetForm from '../../components/finance/BudgetForm';
import BudgetRow from '../../components/finance/BudgetRow';
import BudgetExecutionPanel from '../../components/finance/BudgetExecutionPanel';
import { useApiFetch } from '../../hooks/useApiFetch';
import './finance.css';

// Período por defecto: mes actual (YYYY-MM).
function currentMonthPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function Budgets() {
  const apiFetch = useApiFetch();
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [executionRefreshKey, setExecutionRefreshKey] = useState(0);

  const queryString = useMemo(() => (period ? `?period=${encodeURIComponent(period)}` : ''), [period]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/budgets${queryString}`)
      .then(r => r.json())
      .then(data => setBudgets(Array.isArray(data) ? data : []))
      .catch(() => setToast({ type: 'error', message: 'No se pudo cargar la lista.' }))
      .finally(() => setLoading(false));
  }, [apiFetch, queryString]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (payload) => {
    setSaving(true);
    const isEdit = Boolean(payload.id);
    const url = isEdit ? `/api/budgets/${payload.id}` : '/api/budgets';
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
      setToast({ type: 'success', message: isEdit ? 'Presupuesto actualizado.' : 'Presupuesto creado.' });
      setShowForm(false);
      setEditing(null);
      load();
      setExecutionRefreshKey(k => k + 1);
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await apiFetch(`/api/budgets/${confirmDelete}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar.');
      setToast({ type: 'success', message: 'Presupuesto eliminado.' });
      load();
      setExecutionRefreshKey(k => k + 1);
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setConfirmDelete(null);
    }
  };

  const startEdit = (budget) => { setEditing(budget); setShowForm(true); };
  const startCreate = () => { setEditing(null); setShowForm(true); };
  const cancel = () => { setShowForm(false); setEditing(null); };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiDollarSign /> Presupuestos</h2>
        {!showForm && (
          <button className="btn-primary" onClick={startCreate}>
            <FiPlus /> Nuevo presupuesto
          </button>
        )}
      </div>

      {!showForm && (
        <div className="finance-filters">
          <div className="finance-field">
            <label>Período</label>
            <input
              type="text"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2026-04 | 2026-Q2 | 2026"
            />
          </div>
        </div>
      )}

      {!showForm && period && (
        <BudgetExecutionPanel period={period} refreshKey={executionRefreshKey} />
      )}

      {showForm && (
        <BudgetForm
          initial={editing}
          defaultPeriod={period}
          onSubmit={handleSave}
          onCancel={cancel}
          saving={saving}
        />
      )}

      {loading ? (
        <p className="finance-empty">Cargando…</p>
      ) : budgets.length === 0 ? (
        <p className="finance-empty">No hay presupuestos registrados para el período {period || 'actual'}.</p>
      ) : (
        <div className="lote-list">
          {budgets.map(b => (
            <BudgetRow key={b.id} budget={b} onEdit={startEdit} onDelete={setConfirmDelete} />
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Eliminar presupuesto"
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

export default Budgets;
