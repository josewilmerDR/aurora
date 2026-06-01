import { FiAlertTriangle } from 'react-icons/fi';
import { formatMoney } from '../../../lib/formatMoney';

const SOURCE_LABELS = { manual: 'Manual', bank: 'Bancario' };

// Marca de negativo que no depende solo del color: ícono + texto para lectores
// de pantalla / daltonismo. El color lo agrega la clase del contenedor.
function NegativeFlag() {
  return (
    <>
      {' '}
      <FiAlertTriangle size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} />
      <span className="fin-sr-only"> (en negativo)</span>
    </>
  );
}

// Bloque de estadísticas de la proyección. Recibe datos ya validados —
// asume que `summary` y `startingBalance` existen (validado en el hook).
// `source` es el saldo base (fecha + fuente); puede ser null si no hay saldo
// registrado (en ese caso la página ya muestra el banner de aviso).
function TreasuryStats({ startingBalance, summary, currency, source }) {
  const endingNeg = summary.endingBalance < 0;
  const minNeg = summary.minBalance < 0;
  const sourceLabel = source && (SOURCE_LABELS[source.source] || source.source);

  return (
    <dl className="treasury-stats">
      <div className="treasury-stat-item">
        <dt>Saldo inicial</dt>
        <dd>
          <strong>{formatMoney(startingBalance, currency)}</strong>
          {source?.dateAsOf && (
            <span className="treasury-stat-meta">al {source.dateAsOf}{sourceLabel ? ` · ${sourceLabel}` : ''}</span>
          )}
        </dd>
      </div>
      <div className="treasury-stat-item">
        <dt>Entradas</dt>
        <dd><strong>{formatMoney(summary.totalInflows, currency)}</strong></dd>
      </div>
      <div className="treasury-stat-item">
        <dt>Salidas</dt>
        <dd><strong>{formatMoney(summary.totalOutflows, currency)}</strong></dd>
      </div>
      <div className={`treasury-stat-item${endingNeg ? ' treasury-stat--negative' : ''}`}>
        <dt>Saldo final</dt>
        <dd>
          <strong>{formatMoney(summary.endingBalance, currency)}</strong>
          {endingNeg && <NegativeFlag />}
        </dd>
      </div>
      <div className={`treasury-stat-item${minNeg ? ' treasury-stat--negative' : ''}`}>
        <dt>Mínimo</dt>
        <dd>
          <strong>{formatMoney(summary.minBalance, currency)}</strong>
          {summary.minBalanceDate && <span className="treasury-stat-meta">{summary.minBalanceDate}</span>}
          {minNeg && <NegativeFlag />}
        </dd>
      </div>
      {summary.negativeWeeks > 0 && (
        <div className="treasury-stat-item treasury-stat--negative">
          <dt>Alerta</dt>
          <dd>
            <FiAlertTriangle size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} />{' '}
            <strong>{summary.negativeWeeks} semanas en negativo</strong>
          </dd>
        </div>
      )}
    </dl>
  );
}

export default TreasuryStats;
