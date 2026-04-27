import { useEffect, useState } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

// Urgency → aur-badge variant. Coherente con backend classification.
const URGENCY_BADGE_VARIANT = {
  critical: { label: 'Crítico', cls: 'aur-badge--magenta' },
  high:     { label: 'Alto',    cls: 'aur-badge--yellow' },
  medium:   { label: 'Medio',   cls: 'aur-badge--blue' },
  low:      { label: 'Bajo',    cls: 'aur-badge--gray' },
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
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiAlertTriangle size={14} /></span>
        <h3 className="aur-section-title">Brechas de stock</h3>
        <span className="aur-section-count">{data?.gapsCount ?? 0}</span>
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
                const u = URGENCY_BADGE_VARIANT[g.urgency] || URGENCY_BADGE_VARIANT.low;
                return (
                  <div key={g.productoId} className="fin-budget-row">
                    <div className="fin-budget-row-head">
                      <span className="fin-budget-row-cat">{g.nombreComercial || g.productoId}</span>
                      <span className={`aur-badge ${u.cls}`}>{u.label}</span>
                    </div>
                    <span className="fin-widget-sub">
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
    </section>
  );
}

export default StockGapsWidget;
