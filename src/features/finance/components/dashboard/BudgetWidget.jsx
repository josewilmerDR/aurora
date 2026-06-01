import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FiTrendingUp, FiPlus, FiAlertTriangle } from 'react-icons/fi';
import { formatMoney, currentMonthPeriod, FUNCTIONAL_CURRENCY } from '../../lib/format';
import { useFinanceResource } from '../../hooks/useFinanceResource';
import WidgetSkeleton from './WidgetSkeleton';
import WidgetError from './WidgetError';

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

const MAX_ROWS = 6;

function pctClass(pct) {
  if (pct == null) return '';
  if (pct > 100) return 'fin-budget-row-pct--over';
  if (pct >= 80) return 'fin-budget-row-pct--warn';
  return '';
}

function BudgetWidget() {
  const period = useMemo(currentMonthPeriod, []);
  const { data, loading, error, reload } = useFinanceResource(
    `/api/budgets/execution?period=${period}`,
    { errorMessage: 'No se pudo cargar la ejecución.' }
  );

  // Solo filas con budget asignado > 0; priorizamos las más consumidas.
  const allWithBudget = (data?.rows || [])
    .filter(r => r.assignedAmount > 0)
    .sort((a, b) => (b.percentConsumed || 0) - (a.percentConsumed || 0));
  const rowsWithBudget = allWithBudget.slice(0, MAX_ROWS);
  const hiddenRows = allWithBudget.length - rowsWithBudget.length;

  const summary = data?.summary;

  // Marcador de empty state para borde dasheado + bg sutil (C1).
  const isEmptyState = !loading && !error && data && rowsWithBudget.length === 0;
  const sectionCls = `aur-section${isEmptyState ? ' fin-widget--empty' : ''}`;

  return (
    <section className={sectionCls}>
      <div className="aur-section-header">
        <span className="aur-section-num"><FiTrendingUp size={14} /></span>
        <h3 className="aur-section-title">Presupuesto</h3>
        <span className="aur-section-count">{period}</span>
        {!isEmptyState && (
          <Link className="fin-widget-header-cta aur-touch-target" to="/finance/budgets">
            Ver Presupuestos →
          </Link>
        )}
      </div>

      {loading && <WidgetSkeleton label="Cargando ejecución del presupuesto…" />}
      {error && <WidgetError message={error} onRetry={reload} />}

      {!loading && !error && data && (
        <>
          {summary?.totalAssigned > 0 && (
            <div className="fin-widget-stats">
              <div>
                <span>Asignado</span>
                <strong>{formatMoney(summary.totalAssigned, FUNCTIONAL_CURRENCY)}</strong>
              </div>
              <div>
                <span>Ejecutado</span>
                <strong>{formatMoney(summary.totalExecuted, FUNCTIONAL_CURRENCY)}</strong>
              </div>
              <div>
                <span>% Consumido</span>
                <strong className={summary.percentConsumed > 100 ? 'fin-widget-primary--negative' : ''}>
                  {summary.percentConsumed != null ? `${summary.percentConsumed.toFixed(1)}%` : '—'}
                </strong>
              </div>
            </div>
          )}

          {rowsWithBudget.length === 0 ? (
            <div className="fin-widget-empty-state">
              <FiTrendingUp size={28} className="fin-widget-empty-icon" />
              <p className="fin-widget-empty-text">
                Sin presupuestos con monto asignado para {period}. Definí tus
                metas para comparar contra el gasto real.
              </p>
              <Link
                to="/finance/budgets"
                className="aur-btn-pill aur-btn-pill--sm fin-widget-empty-cta"
              >
                <FiPlus size={12} /> Crear presupuesto del mes
              </Link>
            </div>
          ) : (
            <div className="fin-budget-rows">
              {rowsWithBudget.map(r => {
                const pct = r.percentConsumed;
                const widthPct = Math.min(pct ?? 0, 100);
                const isOver = pct > 100;
                let fillCls = 'finance-progress-fill';
                if (isOver) fillCls += ' finance-progress-fill--over';
                else if (pct >= 80) fillCls += ' finance-progress-fill--warn';
                return (
                  <div key={r.category} className="fin-budget-row">
                    <div className="fin-budget-row-head">
                      <span className="fin-budget-row-cat">{CATEGORY_LABELS[r.category] || r.category}</span>
                      <span className={`fin-budget-row-pct ${pctClass(pct)}`}>
                        {/* Icono además del color: el sobregiro no puede
                            depender solo de rojo (daltonismo). */}
                        {isOver && <FiAlertTriangle size={10} aria-hidden="true" />}
                        {pct != null ? `${pct.toFixed(0)}%` : '—'}
                      </span>
                    </div>
                    <span className="finance-progress fin-budget-row-bar">
                      <span className={fillCls} style={{ width: `${widthPct}%` }} />
                    </span>
                  </div>
                );
              })}
              {hiddenRows > 0 && (
                <Link to="/finance/budgets" className="fin-commits-more">
                  +{hiddenRows} categorías más
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default BudgetWidget;
