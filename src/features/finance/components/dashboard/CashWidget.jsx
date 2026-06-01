import { Link } from 'react-router-dom';
import { FiActivity, FiPlus } from 'react-icons/fi';
import { formatMoney } from '../../lib/format';
import WidgetSkeleton from './WidgetSkeleton';
import WidgetError from './WidgetError';

// Mini sparkline — saldos semanales del horizonte. Decorativo: los valores
// clave (proyectado, mínimo) ya están en .fin-widget-stats, así que va
// marcado aria-hidden para no ensuciar la navegación del lector de pantalla.
function Sparkline({ series }) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const values = series.map(w => w.closingBalance);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = (max - min) || 1;
  const yMax = max + range * 0.05;
  const yMin = min - range * 0.05;
  const W = 300, H = 60;

  const x = (i) => (i / (values.length - 1)) * W;
  const y = (v) => (1 - (v - yMin) / (yMax - yMin)) * H;

  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${x(values.length - 1).toFixed(1)} ${H} L 0 ${H} Z`;
  const zeroY = y(0);

  return (
    <svg className="fin-sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {yMin < 0 && yMax > 0 && (
        <line className="fin-sparkline-baseline" x1="0" x2={W} y1={zeroY} y2={zeroY} />
      )}
      <path className="fin-sparkline-area" d={areaPath} />
      <path className="fin-sparkline-line" d={linePath} />
    </svg>
  );
}

// CashWidget — prop-driven. La proyección de tesorería (weeks=12) la fetchea
// la página una sola vez y la comparte con Compromisos, evitando 2 llamadas
// al mismo endpoint pesado. Recibe { data, loading, error, reload }.
function CashWidget({ data, loading, error, reload }) {
  const currency = data?.startingBalanceSource?.currency || 'USD';
  const isNegativeEnd = data?.summary?.endingBalance < 0;
  // El saldo actual se colorea por SU PROPIO signo, no por el proyectado:
  // un saldo positivo hoy no debe verse rojo solo porque la proyección
  // termine negativa (eso se señala en "Proyectado").
  const isNegativeNow = data?.startingBalance < 0;
  // Sin saldo registrado = sin proyección útil. El backend devuelve data
  // con startingBalance=0 y startingBalanceSource=null en este caso.
  const hasBalance = !!data?.startingBalanceSource;

  // .fin-widget--empty: borde dasheado + bg sutil que comunica
  // "espacio reservado, llenable" cuando aún no hay data registrada.
  const sectionCls = `aur-section${!loading && !error && data && !hasBalance ? ' fin-widget--empty' : ''}`;

  return (
    <section className={sectionCls}>
      <div className="aur-section-header">
        <span className="aur-section-num"><FiActivity size={14} /></span>
        <h3 className="aur-section-title">Caja</h3>
        {data?.weeks ? <span className="aur-section-count">Proyección {data.weeks}s</span> : null}
        {hasBalance && (
          <Link className="fin-widget-header-cta aur-touch-target" to="/finance/treasury">
            Ver Tesorería →
          </Link>
        )}
      </div>

      {loading && <WidgetSkeleton label="Cargando saldo de caja…" />}
      {error && <WidgetError message={error} onRetry={reload} />}

      {!loading && !error && data && !hasBalance && (
        <div className="fin-widget-empty-state">
          <FiActivity size={28} className="fin-widget-empty-icon" />
          <p className="fin-widget-empty-text">
            Aún no hay saldo de caja registrado. Sin saldo inicial no podemos
            proyectar tu liquidez.
          </p>
          <Link
            to="/finance/treasury"
            className="aur-btn-pill aur-btn-pill--sm fin-widget-empty-cta"
          >
            <FiPlus size={12} /> Registrar saldo inicial
          </Link>
        </div>
      )}

      {!loading && !error && data && hasBalance && (
        <>
          <div>
            <div className={`fin-widget-primary${isNegativeNow ? ' fin-widget-primary--negative' : ''}`}>
              {formatMoney(data.startingBalance, currency)}
            </div>
            <div className="fin-widget-sub">Saldo actual</div>
          </div>

          <Sparkline series={data.series} />

          <div className="fin-widget-stats">
            <div>
              <span>Proyectado</span>
              <strong className={isNegativeEnd ? 'fin-widget-primary--negative' : ''}>{formatMoney(data.summary?.endingBalance, currency)}</strong>
            </div>
            <div>
              <span>Mínimo</span>
              <strong className={data.summary?.minBalance < 0 ? 'fin-widget-primary--negative' : ''}>
                {formatMoney(data.summary?.minBalance, currency)}
              </strong>
            </div>
            {data.summary?.negativeWeeks > 0 && (
              <div>
                <span>Semanas negativas</span>
                <strong className="fin-widget-primary--negative">{data.summary.negativeWeeks}</strong>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default CashWidget;
