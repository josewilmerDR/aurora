import { useEffect, useState } from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import BudgetProgressBar from './BudgetProgressBar';
import { useApiFetch } from '../../hooks/useApiFetch';

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

function fmt(n, currency = 'USD') {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Panel que muestra la ejecución (asignado vs. ejecutado) del período.
function BudgetExecutionPanel({ period, refreshKey }) {
  const apiFetch = useApiFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!period) return;
    setLoading(true);
    setError(null);
    apiFetch(`/api/budgets/execution?period=${encodeURIComponent(period)}`)
      .then(async r => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.message || 'No se pudo obtener la ejecución.');
        }
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [period, refreshKey, apiFetch]);

  if (!period) return null;

  return (
    <div className="finance-execution-card">
      <div className="finance-execution-header">
        <div>
          <strong>Ejecución presupuestaria — {period}</strong>
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

      {loading && <p className="finance-empty">Cargando ejecución…</p>}
      {error && <p className="finance-empty" style={{ color: '#ff8080' }}>{error}</p>}
      {!loading && !error && data?.rows && (
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
              const rowCls = r.overBudget
                ? 'finance-row-over'
                : (r.assignedAmount === 0 && r.executedAmount === 0 ? 'finance-row-nobudget' : '');
              return (
                <tr key={r.category} className={rowCls}>
                  <td>{label}</td>
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
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default BudgetExecutionPanel;
