import { useState, useEffect, useMemo, useRef } from 'react';
import { FiPlus, FiDollarSign, FiChevronRight, FiInfo } from 'react-icons/fi';
import { useToast } from '../../../contexts/ToastContext';
import PageHeader from '../../../components/PageHeader';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import BudgetForm from '../components/BudgetForm';
import BudgetExecutionPanel from '../components/BudgetExecutionPanel';
import { useApiFetch } from '../../../hooks/useApiFetch';
import {
  formatPeriod,
  shortPeriod,
  currentMonthPeriod,
  buildPeriodOptions,
} from '../../../lib/periodFormat';
import { formatMoney } from '../../../lib/formatMoney';
import { BUDGET_CATEGORY_LABELS } from '../lib/budgetCategories';
import '../styles/finance.css';

function Budgets() {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // Guardamos el presupuesto COMPLETO (no solo el id) para poder mostrar su
  // detalle en el modal de confirmación de borrado.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [executionRefreshKey, setExecutionRefreshKey] = useState(0);
  // toast local migrado a useToast() (cola global del ToastProvider).
  const carouselRef = useRef(null);
  const formPanelRef = useRef(null);
  const headerCreateRef = useRef(null);
  const prevShowForm = useRef(false);

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
        toast.error('No se pudo cargar la lista.');
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

  // Gestión de foco del formulario inline (no es un modal, así que no hereda el
  // focus-trap de AuroraModal). Al abrir movemos el foco a su primer control —el
  // botón que lo disparó se oculta y si no el foco caería al <body>—; al cerrar
  // lo devolvemos al botón "Nuevo presupuesto" del header, que reaparece.
  useEffect(() => {
    if (showForm) {
      const first = formPanelRef.current?.querySelector('input, select, textarea, button');
      first?.focus();
    } else if (prevShowForm.current) {
      headerCreateRef.current?.focus();
    }
    prevShowForm.current = showForm;
  }, [showForm]);

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
      toast.success(isEdit ? 'Presupuesto actualizado.' : 'Presupuesto creado.');
      setShowForm(false);
      setEditing(null);
      // Saltamos al período del presupuesto recién guardado para que el usuario
      // vea el cambio (puede haberlo creado para un período distinto al activo).
      if (payload.period) setPeriod(payload.period);
      setExecutionRefreshKey(k => k + 1);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || deleting) return;
    const id = confirmDelete.id;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/budgets/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al eliminar.');
      }
      // Update optimista: sacamos la fila de inmediato y refrescamos la
      // ejecución (que sí necesita recálculo del backend).
      setBudgets(prev => prev.filter(b => b.id !== id));
      toast.success('Presupuesto eliminado.');
      setExecutionRefreshKey(k => k + 1);
    } catch (e) {
      toast.error(e.message);
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
        {items.map(opt => {
          const isActive = period === opt.value;
          return (
            <li key={opt.value} className={`lote-list-item${isActive ? ' active' : ''}`}>
              <button
                type="button"
                className="lote-list-item-btn"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => setPeriod(opt.value)}
              >
                <span className="lote-list-info">
                  <span className="lote-list-code">{opt.label}</span>
                </span>
                <FiChevronRight size={14} className="lote-list-arrow" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  // ¿El período activo no tiene ningún presupuesto pero sí hay otros cargados?
  const periodEmpty = !loading && budgets.length > 0 && filteredBudgets.length === 0;

  return (
    <div className={`lote-page budgets-page--selected${showForm ? ' budgets-page--form' : ''}`}>
      {/* ── Carrusel móvil ── */}
      {!showForm && (
        <div className="lote-carousel" ref={carouselRef}>
          {allPeriodOptions.map(opt => {
            const isActive = period === opt.value;
            return (
              <button
                key={opt.value}
                className={`lote-bubble${isActive ? ' lote-bubble--active' : ''}`}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => setPeriod(opt.value)}
              >
                <span className="lote-bubble-avatar">{shortPeriod(opt.value)}</span>
                <span className="lote-bubble-label">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Header ── */}
      <PageHeader
        level={2}
        icon={<FiDollarSign />}
        title="Presupuestos"
        actions={!showForm && (
          <button className="aur-btn-pill" onClick={startCreate} ref={headerCreateRef}>
            <FiPlus /> Nuevo presupuesto
          </button>
        )}
      />

      <div className="lote-management-layout">
        {/* ── Panel principal (izquierda) ── */}
        <div className="budgets-main-panel" ref={formPanelRef}>
          {showForm ? (
            <BudgetForm
              initial={editing}
              defaultPeriod={period}
              periodOptions={allPeriodOptions}
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
          {!showForm && periodEmpty && (
            <div className="aur-banner aur-banner--info">
              <FiInfo size={14} />
              <span>No hay presupuestos asignados para {formatPeriod(period)}.</span>
              <button
                className="aur-btn-text"
                style={{ marginLeft: 'auto', flexShrink: 0 }}
                onClick={startCreate}
              >
                <FiPlus /> Crear presupuesto para este período
              </button>
            </div>
          )}
          {!showForm && !loading && budgets.length === 0 && (
            <div className="siembra-empty-state">
              <FiDollarSign size={36} />
              <p>Aún no hay presupuestos registrados.</p>
              <button className="aur-btn-pill" onClick={startCreate}>
                <FiPlus /> Crear primer presupuesto
              </button>
            </div>
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
        <AuroraConfirmModal
          danger
          title="Eliminar presupuesto"
          body={
            <>
              Vas a eliminar el presupuesto de{' '}
              <strong>{BUDGET_CATEGORY_LABELS[confirmDelete.category] || confirmDelete.category}</strong>
              {confirmDelete.subcategory ? ` (${confirmDelete.subcategory})` : ''} por{' '}
              <strong>{formatMoney(confirmDelete.assignedAmount, confirmDelete.currency)}</strong>{' '}
              de {formatPeriod(confirmDelete.period)}. Esta acción no se puede deshacer.
            </>
          }
          confirmLabel="Eliminar"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
          loading={deleting}
        />
      )}
    </div>
  );
}

export default Budgets;
