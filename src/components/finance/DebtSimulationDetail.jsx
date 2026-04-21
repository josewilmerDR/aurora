import { FiArrowLeft, FiAlertTriangle, FiInfo, FiDollarSign, FiTrendingUp, FiTrendingDown } from 'react-icons/fi';
import CashflowDualChart from './CashflowDualChart';
import { formatMoney, formatNumber } from '../../lib/formatMoney';

const RECOMMENDATION_LABELS = {
  tomar: { label: 'Tomar', cls: 'fin-badge--ok' },
  tomar_condicional: { label: 'Tomar (condicional)', cls: 'fin-badge--warn' },
  no_tomar: { label: 'No tomar', cls: 'fin-badge--bad' },
};

const SCENARIO_TOOLTIP = {
  Pesimista: 'Promedio del tercio inferior de corridas MC (peor año posible).',
  Base: 'Promedio del tercio central (año típico).',
  Optimista: 'Promedio del tercio superior (mejor año posible).',
};

const WARNING_LABELS = {
  DEBT_CAUSES_NEGATIVE_CASH_IN_PESSIMISTIC:
    'En el escenario pesimista, tomar la deuda hace que la caja mediana termine en negativo.',
};

function warningText(raw) {
  if (WARNING_LABELS[raw]) return WARNING_LABELS[raw];
  if (raw.startsWith('TRUNCATED_AT_HORIZON:')) {
    const parts = raw.split(':');
    return `La simulación no cubre el plazo completo del crédito: queda un saldo de ${parts[2] || '?'} al final del horizonte.`;
  }
  return raw;
}

function MetricCard({ label, value, delta, currency, children }) {
  const deltaNum = Number(delta);
  const positive = Number.isFinite(deltaNum) && deltaNum >= 0;
  return (
    <div className="debt-sim-metric-card">
      <span className="debt-sim-metric-label">{label}</span>
      <strong className="debt-sim-metric-value">
        {currency ? formatMoney(value, currency, { decimals: 0 }) : formatNumber(value, { decimals: 0 })}
      </strong>
      {Number.isFinite(deltaNum) && (
        <span className={`debt-sim-metric-delta ${positive ? 'debt-sim-metric-delta--positive' : 'debt-sim-metric-delta--negative'}`}>
          {positive ? <FiTrendingUp size={11} /> : <FiTrendingDown size={11} />}
          {currency ? formatMoney(delta, currency, { decimals: 0 }) : formatNumber(delta, { decimals: 0 })}
        </span>
      )}
      {children}
    </div>
  );
}

function DebtSimulationDetail({ simulation, onBack }) {
  if (!simulation) return null;

  const rec = simulation.recommendation || {};
  const recBadge = RECOMMENDATION_LABELS[rec.recommendation];
  const delta = simulation.delta || {};
  const resumenDelta = delta.resumen || {};
  const scenarioDelta = delta.byScenario || {};

  const currency = simulation.moneda || 'USD';

  const withDebtCash = simulation.withDebt?.trialsAggregate?.cashByMonthMedian || [];
  const withoutDebtCash = simulation.withoutDebt?.trialsAggregate?.cashByMonthMedian || [];
  const monthLabels = Array.from({ length: Math.max(withDebtCash.length, withoutDebtCash.length) }, (_, i) => `m${i + 1}`);

  const scenarios = ['Pesimista', 'Base', 'Optimista'];
  const withScenarios = simulation.withDebt?.scenarios || [];
  const withoutScenarios = simulation.withoutDebt?.scenarios || [];
  const findScenario = (arr, name) => arr.find(s => s.name === name);

  const payments = simulation.debtCashFlow?.paymentsByMonth || [];

  return (
    <div className="debt-sim-detail">
      <div className="debt-sim-detail-header">
        <button className="debt-sim-back-btn" onClick={onBack}>
          <FiArrowLeft size={14} /> Volver a simulaciones
        </button>
      </div>

      <div className="debt-sim-detail-top">
        <div className="debt-sim-detail-title">
          <h3>
            {formatMoney(simulation.amount, currency, { decimals: 0 })} · {simulation.plazoMeses}m
            {' '}a {(Number(simulation.apr) * 100).toFixed(2)}%
          </h3>
          <p className="debt-sim-detail-sub">
            {simulation.providerName || 'Proveedor'} · {simulation.useCase?.tipo || '—'}
            {simulation.useCase?.detalle ? ` · ${simulation.useCase.detalle}` : ''}
          </p>
        </div>
        {recBadge && (
          <div className="debt-sim-rec-block">
            <span className={`fin-badge ${recBadge.cls} debt-sim-rec-badge`}>{recBadge.label}</span>
            {rec.razon && <p className="debt-sim-rec-reason">{rec.razon}</p>}
            {Array.isArray(rec.condiciones) && rec.condiciones.length > 0 && (
              <ul className="debt-sim-rec-conditions">
                {rec.condiciones.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            )}
            {rec.riesgoPrincipal && (
              <p className="debt-sim-rec-risk">
                <FiAlertTriangle size={12} /> <strong>Riesgo:</strong> {rec.riesgoPrincipal}
              </p>
            )}
          </div>
        )}
      </div>

      {Array.isArray(simulation.warnings) && simulation.warnings.length > 0 && (
        <div className="debt-sim-warnings">
          {simulation.warnings.map((w, i) => (
            <div key={i} className="debt-sim-warning">
              <FiAlertTriangle size={14} />
              <span>{warningText(w)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="debt-sim-section-title">Impacto medio — {simulation.nTrials} corridas, {simulation.horizonteMeses} meses</div>
      <div className="debt-sim-metrics">
        <MetricCard
          label="Margen medio (con deuda)"
          value={resumenDelta.margenMedio?.withDebt}
          delta={resumenDelta.margenMedio?.delta}
          currency={currency}
        />
        <MetricCard
          label="Caja final media (con deuda)"
          value={resumenDelta.cajaFinalMedia?.withDebt}
          delta={resumenDelta.cajaFinalMedia?.delta}
          currency={currency}
        />
        <MetricCard
          label="Pago total del crédito"
          value={payments.reduce((s, v) => s + (Number(v) || 0), 0)}
          currency={currency}
        />
      </div>

      <div className="debt-sim-section-title">Proyección mediana de caja mes a mes</div>
      <CashflowDualChart
        withDebt={withDebtCash}
        withoutDebt={withoutDebtCash}
        labels={monthLabels}
      />

      <div className="debt-sim-section-title">Escenarios Monte Carlo</div>
      <div className="debt-sim-scenario-grid">
        {scenarios.map(name => {
          const w = findScenario(withScenarios, name);
          const wo = findScenario(withoutScenarios, name);
          const d = scenarioDelta[name] || {};
          if (!w || !wo) return null;
          return (
            <div key={name} className="debt-sim-scenario-card">
              <div className="debt-sim-scenario-header">
                <strong>{name}</strong>
                <span title={SCENARIO_TOOLTIP[name]}><FiInfo size={11} /></span>
              </div>
              <div className="debt-sim-scenario-row">
                <span>Margen sin deuda</span>
                <strong>{formatMoney(wo.margenProyectado, currency, { decimals: 0 })}</strong>
              </div>
              <div className="debt-sim-scenario-row">
                <span>Margen con deuda</span>
                <strong>{formatMoney(w.margenProyectado, currency, { decimals: 0 })}</strong>
              </div>
              <div className={`debt-sim-scenario-row debt-sim-scenario-row--delta ${Number(d.margen?.delta) >= 0 ? 'is-positive' : 'is-negative'}`}>
                <span>Δ margen</span>
                <strong>{formatMoney(d.margen?.delta, currency, { decimals: 0 })}</strong>
              </div>
              <div className="debt-sim-scenario-divider" />
              <div className="debt-sim-scenario-row">
                <span>Caja final mediana (p50)</span>
                <strong>{formatMoney(w.percentiles?.cajaFinal?.p50, currency, { decimals: 0 })}</strong>
              </div>
              <div className="debt-sim-scenario-row debt-sim-scenario-row--minor">
                <span>p10 · p90</span>
                <span>
                  {formatMoney(w.percentiles?.cajaFinal?.p10, currency, { decimals: 0 })}
                  {' · '}
                  {formatMoney(w.percentiles?.cajaFinal?.p90, currency, { decimals: 0 })}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {payments.length > 0 && (
        <>
          <div className="debt-sim-section-title">Cronograma de pagos</div>
          <div className="debt-sim-payments-table-wrap">
            <table className="debt-sim-payments-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="td-num">Pago</th>
                  <th className="td-num">Retorno esperado</th>
                  <th className="td-num">Neto</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => {
                  const payment = Number(p) || 0;
                  const extraRev = Number(simulation.useCaseImpact?.extraRevenueByMonth?.[i]) || 0;
                  const extraCostDelta = Number(simulation.useCaseImpact?.extraCostByMonth?.[i]) || 0;
                  const netReturn = extraRev - extraCostDelta;
                  const net = netReturn - payment;
                  if (payment === 0 && netReturn === 0) return null;
                  return (
                    <tr key={i}>
                      <td>m{i + 1}</td>
                      <td className="td-num">{formatMoney(payment, currency, { decimals: 0 })}</td>
                      <td className="td-num">{formatMoney(netReturn, currency, { decimals: 0 })}</td>
                      <td className={`td-num ${net >= 0 ? 'debt-sim-net-positive' : 'debt-sim-net-negative'}`}>
                        {formatMoney(net, currency, { decimals: 0 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="debt-sim-footnote">
        <FiDollarSign size={11} /> Los valores son medianas sobre {simulation.nTrials} corridas Monte Carlo con volatilidad
        de precio {((simulation.baseline?.priceVolatility ?? 0.15) * 100).toFixed(0)}% y rendimiento
        {' '}{((simulation.baseline?.yieldVolatility ?? 0.10) * 100).toFixed(0)}%.
        La decisión sigue siendo humana — este dominio opera en Nivel 1 (solo recomendación).
      </p>
    </div>
  );
}

export default DebtSimulationDetail;
