// Chart SVG simple sin dependencias — serie de saldos semanales.
// Dibuja una línea + área bajo la curva + línea base en cero.

const PAD = { top: 10, right: 12, bottom: 24, left: 52 };
const WIDTH = 720;
const HEIGHT = 220;

function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}

function ProjectionChart({ series }) {
  if (!Array.isArray(series) || series.length === 0) {
    return <p className="finance-empty">No hay datos para graficar.</p>;
  }

  const values = series.map(w => w.closingBalance);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  // Añadimos margen superior/inferior del 10% para que la línea no toque los bordes.
  const range = (max - min) || 1;
  const yMax = max + range * 0.1;
  const yMin = min - range * 0.1;

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (i) => PAD.left + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L ${x(values.length - 1).toFixed(2)} ${(PAD.top + innerH).toFixed(2)} L ${x(0).toFixed(2)} ${(PAD.top + innerH).toFixed(2)} Z`;
  const zeroY = y(0);

  // Eje Y con 3 marcas: max, 0 (si entra en rango), min.
  const yTicks = [yMax, 0, yMin].filter((v, i, arr) => arr.indexOf(v) === i);

  return (
    <div className="treasury-chart-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        {/* Grid Y */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              className="treasury-chart-grid"
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(t)}
              y2={y(t)}
            />
            <text x={PAD.left - 6} y={y(t) + 3} fontSize="10" fill="#8ba5bf" textAnchor="end">{fmt(t)}</text>
          </g>
        ))}

        {/* Línea cero cuando 0 cae dentro del rango visible */}
        {yMin < 0 && yMax > 0 && (
          <line className="treasury-chart-baseline" x1={PAD.left} x2={WIDTH - PAD.right} y1={zeroY} y2={zeroY} />
        )}

        {/* Área + línea de saldos */}
        <path className="treasury-chart-area" d={areaPath} />
        <path className="treasury-chart-line" d={linePath} />

        {/* Labels X — primer y último */}
        <text x={PAD.left} y={HEIGHT - 6} fontSize="10" fill="#8ba5bf">
          {series[0].weekStart}
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} fontSize="10" fill="#8ba5bf" textAnchor="end">
          {series[series.length - 1].weekEnd}
        </text>
      </svg>
    </div>
  );
}

export default ProjectionChart;
