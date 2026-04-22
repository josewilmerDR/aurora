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
    <div className="finance-execution-card">
      <div className="finance-execution-header">
        <div>
          <strong>Ejecución presupuestaria — {formatPeriod(period)}</strong>
          {data?.range && (
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              {data.range.from} → {data.range.to}
            </div>
          )}
        </div>
        {data?.summary && (
          <div className="finance-execution-summary">
            <div className="finance-execution-summary-item">
              Asignado: <strong>{fmt(data.summary.totalAssigned)}</strong>
            </div>
            <div className={`finance-execution-summary-item${data.summary.totalRemaining < 0 ? ' finance-execution-summary-item--over' : ''}`}>
              Ejecutado: <strong>{fmt(data.summary.totalExecuted)}</strong>
            </div>
            <div className="finance-execution-summary-item">
              Restante: <strong>{fmt(data.summary.totalRemaining)}</strong>
            </div>
            {data.summary.percentConsumed !== null && (
              <div className="finance-execution-summary-item">
                Consumo: <strong>{data.summary.percentConsumed.toFixed(1)}%</strong>
              </div>
            )}
          </div>
        )}
      </div>

      {loading && !data && <p className="finance-empty">Cargando ejecución…</p>}
      {error && <p className="finance-empty" style={{ color: '#ff8080' }}>{error}</p>}
      {!error && data?.rows && (
        <div className="finance-execution-table-wrap">
        <table className="finance-execution-table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th className="finance-num">Asignado</th>
              <th className="finance-num">Ejecutado</th>
              <th className="finance-num">Restante</th>
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
                        <span className="finance-execution-row-count">{subs.length}</span>
                      )}
                    </td>
                    <td className="finance-num">{fmt(r.assignedAmount)}</td>
                    <td className="finance-num">{fmt(r.executedAmount)}</td>
                    <td className="finance-num">{fmt(r.remaining)}</td>
                    <td>
                      <BudgetProgressBar percent={r.percentConsumed} />
                      {r.percentConsumed !== null && (
                        <span style={{ marginLeft: 8, fontSize: 12 }}>
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
                                  className="btn-icon"
                                  title="Editar"
                                  onClick={() => onEdit && onEdit(b)}
                                >
                                  <FiEdit />
                                </button>
                                <button
                                  className="btn-icon btn-icon-danger"
                                  title="Eliminar"
                                  onClick={() => onDelete && onDelete(b.id)}
                                >
                                  <FiTrash2 />
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
    </div>
  );
}

export default BudgetExecutionPanel;
