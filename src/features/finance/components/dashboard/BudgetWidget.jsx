import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiTrendingUp, FiPlus } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';
import WidgetSkeleton from './WidgetSkeleton';

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

const fmt = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

function currentMonthPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function pctClass(pct) {
  if (pct == null) return '';
  if (pct > 100) return 'fin-budget-row-pct--over';
  if (pct >= 80) return 'fin-budget-row-pct--warn';
  return '';
}

function BudgetWidget() {
  const apiFetch = useApiFetch();
  const period = currentMonthPeriod();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch(`/api/budgets/execution?period=${period}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('No se pudo cargar la ejecución.'))
      .finally(() => setLoading(false));
  }, [apiFetch, period]);

  // Solo mostramos filas con budget asignado > 0; priorizamos las más
  // consumidas primero. Máximo 6 para no saturar.
  const rowsWithBudget = (data?.rows || [])
    .filter(r => r.assignedAmount > 0)
    .sort((a, b) => (b.percentConsumed || 0) - (a.percentConsumed || 0))
    .slice(0, 6);

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
          <Link className="fin-widget-header-cta" to="/finance/presupuestos">
            Ver Presupuestos →
          </Link>
        )}
      </div>

      {loading && <WidgetSkeleton label="Cargando ejecución del presupuesto…" />}
      {error && <div className="fin-widget-error">{error}</div>}

      {!loading && !error && data && (
        <>
          {summary?.totalAssigned > 0 && (
            <div className="fin-widget-stats">
              <div>
                <span>Asignado</span>
                <strong>{fmt(summary.totalAssigned)}</strong>
              </div>
              <div>
                <span>Ejecutado</span>
                <strong>{fmt(summary.totalExecuted)}</strong>
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
                Sin presupuestos asignados para {period}. Definí tus metas para
                comparar contra el gasto real.
              </p>
              <Link
                to="/finance/presupuestos"
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
                let fillCls = 'finance-progress-fill';
                if (pct > 100) fillCls += ' finance-progress-fill--over';
                else if (pct >= 80) fillCls += ' finance-progress-fill--warn';
                return (
                  <div key={r.category} className="fin-budget-row">
                    <div className="fin-budget-row-head">
                      <span className="fin-budget-row-cat">{CATEGORY_LABELS[r.category] || r.category}</span>
                      <span className={`fin-budget-row-pct ${pctClass(pct)}`}>
                        {pct != null ? `${pct.toFixed(0)}%` : '—'}
                      </span>
                    </div>
                    <span className="finance-progress fin-budget-row-bar">
                      <span className={fillCls} style={{ width: `${widthPct}%` }} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* CTA secundaria movida al header (top-right, ver C3). El footer queda
          libre para el CTA primario del empty state cuando aplica. */}
    </section>
  );
}

export default BudgetWidget;
