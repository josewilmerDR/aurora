import { useState, useEffect, useMemo, useRef } from 'react';
import { FiPlus, FiDollarSign, FiChevronRight } from 'react-icons/fi';
import Toast from '../../components/Toast';
import ConfirmModal from '../../components/ConfirmModal';
import BudgetForm from '../../components/finance/BudgetForm';
import BudgetExecutionPanel from '../../components/finance/BudgetExecutionPanel';
import { useApiFetch } from '../../hooks/useApiFetch';
import { formatPeriod, shortPeriod } from '../../lib/periodFormat';
import './finance.css';

// Período por defecto: mes actual (YYYY-MM).
function currentMonthPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Opciones para el selector de período: últimos 12 meses, últimos 4 trimestres
// y los 3 años recientes. Valores en formato canónico (YYYY-MM, YYYY-Qn, YYYY);
// labels en español vía formatPeriod.
function buildPeriodOptions(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();

  const monthValues = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(y, m - i, 1);
    monthValues.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const currentQ = Math.floor(m / 3) + 1;
  const quarterValues = [];
  for (let i = 0; i < 4; i++) {
    let q = currentQ - i;
    let yr = y;
    while (q <= 0) { q += 4; yr -= 1; }
    quarterValues.push(`${yr}-Q${q}`);
  }

  const yearValues = [];
  for (let i = 0; i < 3; i++) yearValues.push(String(y - i));

  const toOption = v => ({ value: v, label: formatPeriod(v) });
  return {
    months: monthValues.map(toOption),
    quarters: quarterValues.map(toOption),
    years: yearValues.map(toOption),
  };
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
  const [deleting, setDeleting] = useState(false);
  const [executionRefreshKey, setExecutionRefreshKey] = useState(0);
  const carouselRef = useRef(null);

  const periodOptions = useMemo(() => buildPeriodOptions(), []);
  const allPeriodOptions = useMemo(
    () => [...periodOptions.months, ...periodOptions.quarters, ...periodOptions.years],
    [periodOptions]
  );

  // Cargamos todos los presupuestos de la finca una vez (y tras crear/editar/
  // eliminar). El filtrado por período se hace en cliente para evitar recargar
  // la tabla al cambiar el filtro.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    apiFetch('/api/budgets', { signal: controller.signal })
      .then(r => r.json())
      .then(data => setBudgets(Array.isArray(data) ? data : []))
      .catch(err => {
        if (err?.name === 'AbortError') return;
        setToast({ type: 'error', message: 'No se pudo cargar la lista.' });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiFetch, executionRefreshKey]);

  // Centra la burbuja activa en el carrusel cuando cambia el período.
  useEffect(() => {
    if (!carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [period]);

  const filteredBudgets = useMemo(
    () => (period ? budgets.filter(b => b.period === period) : budgets),
    [budgets, period]
  );

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
      setExecutionRefreshKey(k => k + 1);
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/budgets/${confirmDelete}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al eliminar.');
      }
      setToast({ type: 'success', message: 'Presupuesto eliminado.' });
      setExecutionRefreshKey(k => k + 1);
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const startEdit = (budget) => { setEditing(budget); setShowForm(true); };
  const startCreate = () => { setEditing(null); setShowForm(true); };
  const cancel = () => { setShowForm(false); setEditing(null); };

  const renderPeriodSection = (title, items) => (
    <div className="budgets-period-section">
      <p className="budgets-period-section-title">{title}</p>
      <ul className="lote-list">
        {items.map(opt => (
          <li
            key={opt.value}
            className={`lote-list-item${period === opt.value ? ' active' : ''}`}
            onClick={() => setPeriod(opt.value)}
          >
            <div className="lote-list-info">
              <span className="lote-list-code">{opt.label}</span>
            </div>
            <FiChevronRight size={14} className="lote-list-arrow" />
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className={`budgets-page budgets-page--selected${showForm ? ' budgets-page--form' : ''}`}>
      {/* ── Carrusel móvil ── */}
      {!showForm && (
        <div className="lote-carousel" ref={carouselRef}>
          {allPeriodOptions.map(opt => (
            <button
              key={opt.value}
              className={`lote-bubble${period === opt.value ? ' lote-bubble--active' : ''}`}
              onClick={() => setPeriod(opt.value)}
            >
              <span className="lote-bubble-avatar">{shortPeriod(opt.value)}</span>
              <span className="lote-bubble-label">{opt.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Header ── */}
      <div className="lote-page-header">
        <h2 className="lote-page-title"><FiDollarSign /> Presupuestos</h2>
        {!showForm && (
          <button className="btn btn-primary" onClick={startCreate}>
            <FiPlus /> Nuevo presupuesto
          </button>
        )}
      </div>

      <div className="lote-management-layout">
        {/* ── Panel principal (izquierda) ── */}
        <div className="budgets-main-panel">
          {showForm ? (
            <BudgetForm
              initial={editing}
              defaultPeriod={period}
              onSubmit={handleSave}
              onCancel={cancel}
              saving={saving}
            />
          ) : period && (
            <BudgetExecutionPanel
              period={period}
              refreshKey={executionRefreshKey}
              budgets={filteredBudgets}
              onEdit={startEdit}
              onDelete={setConfirmDelete}
            />
          )}
          {!showForm && !loading && budgets.length === 0 && (
            <p className="finance-empty">Aún no hay presupuestos registrados. Usa "Nuevo presupuesto" para crear el primero.</p>
          )}
        </div>

        {/* ── Lista de períodos (derecha en desktop) ── */}
        <div className="lote-list-panel">
          {renderPeriodSection('Meses', periodOptions.months)}
          {renderPeriodSection('Trimestres', periodOptions.quarters)}
          {renderPeriodSection('Años', periodOptions.years)}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Eliminar presupuesto"
          message="Esta acción no se puede deshacer."
          onConfirm={handleDelete}
          onCancel={() => !deleting && setConfirmDelete(null)}
          loading={deleting}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

export default Budgets;
