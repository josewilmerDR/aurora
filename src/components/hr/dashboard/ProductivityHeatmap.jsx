import { useEffect, useMemo, useState } from 'react';
import { FiGrid } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Builds a (labor+unidad) → workers matrix from the productivity output.
// Only displays rows where benchmarks exist so the ranking is meaningful.
function ProductivityHeatmap() {
  const apiFetch = useApiFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    const qs = `periodStart=${isoDate(start)}&periodEnd=${isoDate(end)}`;
    apiFetch(`/api/hr/productivity?${qs}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('No se pudo cargar la matriz.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  // Group matrix rows by (labor, unidad). Preserves the insight that
  // buckets of different unidad are NOT comparable.
  const grouped = useMemo(() => {
    if (!data?.matrix) return [];
    const byKey = new Map();
    for (const r of data.matrix) {
      const key = `${r.labor}|||${r.unidad || ''}`;
      if (!byKey.has(key)) byKey.set(key, { labor: r.labor, unidad: r.unidad, rows: [] });
      byKey.get(key).rows.push(r);
    }
    const bench = new Map();
    for (const b of data.benchmarks || []) {
      bench.set(`${b.labor}|||${b.unidad || ''}`, b);
    }
    return Array.from(byKey.values())
      .map(g => ({ ...g, benchmark: bench.get(`${g.labor}|||${g.unidad || ''}`) }))
      .slice(0, 8); // top 8 buckets
  }, [data]);

  return (
    <div className="hr-widget hr-widget--wide">
      <div className="hr-widget-header">
        <span className="hr-widget-title"><FiGrid size={14} /> Productividad por labor</span>
        <span className="hr-widget-sub">últimos 3 meses</span>
      </div>

      {loading && <div className="hr-widget-loading">Cargando…</div>}
      {error && <div className="hr-widget-loading hr-widget-error">{error}</div>}
      {!loading && !error && grouped.length === 0 && (
        <div className="hr-widget-empty">Sin planillas en el rango. Crea algunas y vuelve.</div>
      )}

      {!loading && !error && grouped.length > 0 && (
        <div className="hr-prod-groups">
          {grouped.map(g => (
            <div key={`${g.labor}-${g.unidad}`} className="hr-prod-group">
              <div className="hr-prod-group-head">
                <strong>{g.labor}</strong>
                <span className="hr-widget-sub">{g.unidad}</span>
                {g.benchmark && (
                  <span className="hr-widget-sub">
                    p25 {g.benchmark.p25} · p50 {g.benchmark.p50} · p75 {g.benchmark.p75}
                  </span>
                )}
              </div>
              <div className="hr-prod-rows">
                {g.rows.slice(0, 5).map(r => {
                  const bm = g.benchmark;
                  let bucket = 'unknown';
                  if (bm) {
                    if (r.avgCantidad < bm.p25) bucket = 'below_p25';
                    else if (r.avgCantidad > bm.p75) bucket = 'above_p75';
                    else bucket = 'in_range';
                  }
                  return (
                    <div key={`${r.userId}-${r.loteId}`} className={`hr-prod-row hr-prod-row--${bucket}`}>
                      <span className="hr-prod-user">{r.userId}</span>
                      <span className="hr-prod-lote">{r.loteId || '—'}</span>
                      <span className="hr-prod-avg">{r.avgCantidad}</span>
                      <span className="hr-widget-sub">n={r.samples}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ProductivityHeatmap;
