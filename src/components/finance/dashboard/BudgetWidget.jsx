import { useEffect, useState } from 'react';
import { FiTrendingUp } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

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

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiTrendingUp size={14} /> Presupuesto</span>
        <span className="fin-widget-sub">{period}</span>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

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
            <div className="fin-widget-empty">
              Sin presupuestos asignados para {period}.
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
                    <span className="finance-progress" style={{ gridColumn: '1 / -1', width: '100%' }}>
                      <span className={fillCls} style={{ width: `${widthPct}%` }} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default BudgetWidget;
