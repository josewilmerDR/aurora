// Gráfico SVG sin dependencias: dos series mensuales superpuestas (con deuda
// vs sin deuda) para visualizar cómo el crédito mueve la mediana de caja mes
// a mes.

const PAD = { top: 14, right: 14, bottom: 30, left: 56 };
const WIDTH = 720;
const HEIGHT = 240;

function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}

function CashflowDualChart({ withDebt = [], withoutDebt = [], labels = [] }) {
  const H = Math.max(withDebt.length, withoutDebt.length);
  if (H === 0) return <p className="finance-empty">No hay datos para graficar.</p>;

  const a = Array.from({ length: H }, (_, i) => Number(withoutDebt[i]) || 0);
  const b = Array.from({ length: H }, (_, i) => Number(withDebt[i]) || 0);

  const allValues = [...a, ...b, 0];
  const rawMax = Math.max(...allValues);
  const rawMin = Math.min(...allValues);
  const range = (rawMax - rawMin) || 1;
  const yMax = rawMax + range * 0.1;
  const yMin = rawMin - range * 0.1;

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (i) => PAD.left + (H === 1 ? innerW / 2 : (i / (H - 1)) * innerW);
  const y = (v) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const pathFor = (arr) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ');
  const zeroY = y(0);

  const yTicks = [yMax, 0, yMin].filter((v, i, arr) => arr.indexOf(v) === i);

  return (
    <div className="cashflow-dual-chart">
      <div className="cashflow-dual-legend">
        <span className="cashflow-dual-legend-item cashflow-dual-legend-item--without">
          <span className="cashflow-dual-swatch cashflow-dual-swatch--without" /> Sin deuda
        </span>
        <span className="cashflow-dual-legend-item cashflow-dual-legend-item--with">
          <span className="cashflow-dual-swatch cashflow-dual-swatch--with" /> Con deuda
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              className="treasury-chart-grid"
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(t)}
              y2={y(t)}
            />
            <text x={PAD.left - 8} y={y(t) + 3} fontSize="10" fill="#8ba5bf" textAnchor="end">{fmt(t)}</text>
          </g>
        ))}

        {yMin < 0 && yMax > 0 && (
          <line className="treasury-chart-baseline" x1={PAD.left} x2={WIDTH - PAD.right} y1={zeroY} y2={zeroY} />
        )}

        <path className="cashflow-dual-line cashflow-dual-line--without" d={pathFor(a)} />
        <path className="cashflow-dual-line cashflow-dual-line--with" d={pathFor(b)} />

        {a.map((v, i) => (
          <circle key={`a${i}`} className="cashflow-dual-dot cashflow-dual-dot--without" cx={x(i)} cy={y(v)} r="2.5" />
        ))}
        {b.map((v, i) => (
          <circle key={`b${i}`} className="cashflow-dual-dot cashflow-dual-dot--with" cx={x(i)} cy={y(v)} r="2.5" />
        ))}

        {Array.from({ length: H }, (_, i) => {
          const label = labels[i] || `m${i + 1}`;
          if (H > 12 && i % 2 !== 0) return null;
          return (
            <text key={i} x={x(i)} y={HEIGHT - 10} fontSize="10" fill="#8ba5bf" textAnchor="middle">
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default CashflowDualChart;
