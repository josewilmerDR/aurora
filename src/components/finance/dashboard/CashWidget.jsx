import { useEffect, useState } from 'react';
import { FiActivity } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

const fmt = (n, currency = 'USD') => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

// Mini sparkline — saldos semanales del horizonte.
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
    <svg className="fin-sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {yMin < 0 && yMax > 0 && (
        <line className="fin-sparkline-baseline" x1="0" x2={W} y1={zeroY} y2={zeroY} />
      )}
      <path className="fin-sparkline-area" d={areaPath} />
      <path className="fin-sparkline-line" d={linePath} />
    </svg>
  );
}

function CashWidget() {
  const apiFetch = useApiFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/api/treasury/projection?weeks=12')
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('No se pudo cargar la proyección.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const currency = data?.startingBalanceSource?.currency || 'USD';
  const isNegativeEnd = data?.summary?.endingBalance < 0;

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiActivity size={14} /> Caja</span>
        <span className="fin-widget-sub">{data?.weeks ? `Proyección ${data.weeks}s` : ''}</span>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && data && (
        <>
          <div>
            <div className={`fin-widget-primary ${isNegativeEnd ? 'fin-widget-primary--negative' : ''}`}>
              {fmt(data.startingBalance, currency)}
            </div>
            <div className="fin-widget-sub">Saldo actual</div>
          </div>

          <Sparkline series={data.series} />

          <div className="fin-widget-stats">
            <div>
              <span>Proyectado</span>
              <strong className={isNegativeEnd ? 'fin-widget-primary--negative' : ''}>{fmt(data.summary?.endingBalance, currency)}</strong>
            </div>
            <div>
              <span>Mínimo</span>
              <strong className={data.summary?.minBalance < 0 ? 'fin-widget-primary--negative' : ''}>
                {fmt(data.summary?.minBalance, currency)}
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
    </div>
  );
}

export default CashWidget;
