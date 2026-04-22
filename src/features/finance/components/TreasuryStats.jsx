import { formatMoney } from '../../../lib/formatMoney';

// Bloque de estadísticas de la proyección. Recibe datos ya validados —
// asume que `summary` y `startingBalance` existen (validado en el hook).
function TreasuryStats({ startingBalance, summary, currency }) {
  const endingNeg = summary.endingBalance < 0;
  const minNeg = summary.minBalance < 0;
  return (
    <div className="treasury-stats treasury-stats--spaced">
      <div>Saldo inicial: <strong>{formatMoney(startingBalance, currency)}</strong></div>
      <div>Entradas: <strong>{formatMoney(summary.totalInflows, currency)}</strong></div>
      <div>Salidas: <strong>{formatMoney(summary.totalOutflows, currency)}</strong></div>
      <div className={endingNeg ? 'treasury-stat--negative' : ''}>
        Saldo final: <strong>{formatMoney(summary.endingBalance, currency)}</strong>
      </div>
      <div className={minNeg ? 'treasury-stat--negative' : ''}>
        Mínimo: <strong>{formatMoney(summary.minBalance, currency)}</strong>
        {summary.minBalanceDate && ` (${summary.minBalanceDate})`}
      </div>
      {summary.negativeWeeks > 0 && (
        <div className="treasury-stat--negative">
          <strong>{summary.negativeWeeks} semanas en negativo</strong>
        </div>
      )}
    </div>
  );
}

export default TreasuryStats;
