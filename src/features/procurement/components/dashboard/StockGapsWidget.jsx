import { useEffect, useState } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

// Color per urgency band — aligned with the backend classification.
const URGENCY_STYLE = {
  critical: { label: 'Crítico', color: '#ff5050' },
  high:     { label: 'Alto',    color: '#ff9a40' },
  medium:   { label: 'Medio',   color: '#ffd166' },
  low:      { label: 'Bajo',    color: '#66b3ff' },
};

function fmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function StockGapsWidget() {
  const apiFetch = useApiFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/api/procurement/stock-gaps')
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('No se pudieron cargar las brechas.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const topGaps = (data?.gaps || []).slice(0, 6);
  const counts = data?.counts || {};

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiAlertTriangle size={14} /> Brechas de stock</span>
        <span className="fin-widget-sub">{data?.gapsCount ?? 0} productos</span>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && data && (
        <>
          <div className="fin-widget-stats">
            <div>
              <span>Críticos</span>
              <strong className={counts.critical ? 'fin-widget-primary--negative' : ''}>
                {counts.critical || 0}
              </strong>
            </div>
            <div>
              <span>Altos</span>
              <strong>{counts.high || 0}</strong>
            </div>
            <div>
              <span>Medios</span>
              <strong>{counts.medium || 0}</strong>
            </div>
          </div>

          {topGaps.length === 0 ? (
            <div className="fin-widget-empty">Sin brechas detectadas.</div>
          ) : (
            <div className="fin-budget-rows">
              {topGaps.map(g => {
                const u = URGENCY_STYLE[g.urgency] || URGENCY_STYLE.low;
                return (
                  <div key={g.productoId} className="fin-budget-row">
                    <div className="fin-budget-row-head">
                      <span className="fin-budget-row-cat">{g.nombreComercial || g.productoId}</span>
                      <span className="fin-budget-row-pct" style={{ color: u.color }}>
                        {u.label}
                      </span>
                    </div>
                    <span className="fin-widget-sub" style={{ gridColumn: '1 / -1' }}>
                      Stock {fmt(g.stockActual)} / sugerido {fmt(g.suggestedQty)} {g.unidad}
                      {g.daysUntilStockout != null && ` · ${Math.round(g.daysUntilStockout)}d cobertura`}
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

export default StockGapsWidget;
