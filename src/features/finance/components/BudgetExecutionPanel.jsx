import { useEffect, useMemo, useState, Fragment } from 'react';
import { FiChevronRight, FiEdit, FiTrash2 } from 'react-icons/fi';
import BudgetProgressBar from './BudgetProgressBar';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { formatPeriod } from '../../../lib/periodFormat';
import { formatMoney as fmt } from '../../../lib/formatMoney';

const CATEGORY_LABELS = {
  combustible:      'Combustible',
  depreciacion:     'Depreciación',
  planilla_directa: 'Planilla directa',
  planilla_fija:    'Planilla fija',
  insumos:          'Insumos',
  mantenimiento:    'Mantenimiento',
  administrativo:   'Administrativo',
  otro:             'Otro',
};

// Panel que muestra la ejecución (asignado vs. ejecutado) del período.
// Cada categoría es una fila desplegable que, al expandirse, muestra los
// sub-presupuestos asignados a esa categoría con acciones de editar/eliminar.
function BudgetExecutionPanel({ period, refreshKey, budgets = [], onEdit, onDelete }) {
  const apiFetch = useApiFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    if (!period) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch(`/api/budgets/execution?period=${encodeURIComponent(period)}`, { signal: controller.signal })
      .then(async r => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.message || 'No se pudo obtener la ejecución.');
        }
        return r.json();
      })
      .then(setData)
      .catch(e => {
        if (e?.name === 'AbortError') return;
        setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [period, refreshKey, apiFetch]);

  // Colapsa las categorías al cambiar de período (evita expansiones "fantasma"
  // si el usuario cambia de mes y la categoría ya no aplica).
  useEffect(() => { setExpanded(new Set()); }, [period]);

  const budgetsByCategory = useMemo(() => {
    const map = new Map();
    for (const b of budgets) {
      const key = b.category || 'otro';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(b);
    }
    return map;
  }, [budgets]);

  const toggle = (category) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  if (!period) return null;

  return (
    <section className="aur-section">
      <div className="aur-section-header">
        <h3 className="aur-section-title">Ejecución presupuestaria — {formatPeriod(period)}</h3>
        {data?.range && (
          <span className="aur-section-count">
            {data.range.from} → {data.range.to}
          </span>
        )}
      </div>

      {data?.summary && (
        <div className="finance-execution-summary">
          <div className="finance-execution-summary-item">
            <span className="finance-execution-summary-label">Asignado</span>
            <strong>{fmt(data.summary.totalAssigned)}</strong>
          </div>
          <div className={`finance-execution-summary-item${data.summary.totalRemaining < 0 ? ' finance-execution-summary-item--over' : ''}`}>
            <span className="finance-execution-summary-label">Ejecutado</span>
            <strong>{fmt(data.summary.totalExecuted)}</strong>
          </div>
          <div className="finance-execution-summary-item">
            <span className="finance-execution-summary-label">Restante</span>
            <strong>{fmt(data.summary.totalRemaining)}</strong>
          </div>
          {data.summary.percentConsumed !== null && (
            <div className="finance-execution-summary-item">
              <span className="finance-execution-summary-label">Consumo</span>
              <strong>{data.summary.percentConsumed.toFixed(1)}%</strong>
            </div>
          )}
        </div>
      )}

      {loading && !data && <p className="finance-empty">Cargando ejecución…</p>}
      {error && <p className="finance-execution-error">{error}</p>}
      {!error && data?.rows && (
        <div className="aur-table-wrap">
          <table className="aur-table finance-execution-table">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="aur-td-num">Asignado</th>
                <th className="aur-td-num">Ejecutado</th>
                <th className="aur-td-num">Restante</th>
                <th>Consumo</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => {
                const label = CATEGORY_LABELS[r.category] || r.category;
                const subs = budgetsByCategory.get(r.category) || [];
                const isExpandable = subs.length > 0;
                const isExpanded = expanded.has(r.category);
                const rowCls = [
                  r.overBudget ? 'finance-row-over' : '',
                  (r.assignedAmount === 0 && r.executedAmount === 0) ? 'finance-row-nobudget' : '',
                  isExpandable ? 'finance-execution-row-expandable' : '',
                  isExpanded ? 'finance-execution-row-expanded' : '',
                ].filter(Boolean).join(' ');

                return (
                  <Fragment key={r.category}>
                    <tr
                      className={rowCls}
                      onClick={isExpandable ? () => toggle(r.category) : undefined}
                    >
                      <td className="finance-execution-row-category">
                        {isExpandable ? (
                          <FiChevronRight size={12} className="finance-execution-row-chevron" />
                        ) : (
                          <span className="finance-execution-row-chevron-placeholder" />
                        )}
                        {label}
                        {isExpandable && (
                          <span className="aur-badge aur-badge--green finance-execution-row-count">
                            {subs.length}
                          </span>
                        )}
                      </td>
                      <td className="aur-td-num">{fmt(r.assignedAmount)}</td>
                      <td className="aur-td-num">{fmt(r.executedAmount)}</td>
                      <td className="aur-td-num">{fmt(r.remaining)}</td>
                      <td className="finance-execution-consume">
                        <BudgetProgressBar percent={r.percentConsumed} />
                        {r.percentConsumed !== null && (
                          <span className="finance-execution-consume-pct">
                            {r.percentConsumed.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="finance-execution-expanded">
                        <td colSpan={5}>
                          <ul className="finance-execution-sub-list">
                            {subs.map(b => (
                              <li key={b.id} className="finance-execution-subrow">
                                <div className="finance-execution-subrow-info">
                                  {b.subcategory && (
                                    <span className="finance-execution-subrow-sub">{b.subcategory}</span>
                                  )}
                                  <span className="finance-amount">{fmt(b.assignedAmount, b.currency)}</span>
                                  {b.loteId && (
                                    <span className="finance-execution-subrow-meta">Lote: {b.loteId}</span>
                                  )}
                                  {b.notes && (
                                    <span className="finance-execution-subrow-meta">{b.notes}</span>
                                  )}
                                </div>
                                <div className="finance-execution-subrow-actions">
                                  <button
                                    className="aur-icon-btn aur-icon-btn--sm"
                                    title="Editar"
                                    onClick={() => onEdit && onEdit(b)}
                                  >
                                    <FiEdit size={14} />
                                  </button>
                                  <button
                                    className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                                    title="Eliminar"
                                    onClick={() => onDelete && onDelete(b.id)}
                                  >
                                    <FiTrash2 size={14} />
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default BudgetExecutionPanel;
