import { useEffect, useState } from 'react';
import { FiStar } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

function scoreColor(score) {
  if (score == null) return 'var(--aurora-light)';
  if (score >= 75) return '#33ff99';
  if (score >= 50) return '#ffd166';
  return '#ff8080';
}

function SupplierRankingWidget() {
  const apiFetch = useApiFetch();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/api/suppliers/ranking')
      .then(r => r.json())
      .then(data => setRows(data?.rows || []))
      .catch(() => setError('No se pudo cargar el ranking.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const topSuppliers = rows.filter(r => r.score != null).slice(0, 5);
  const withoutHistory = rows.filter(r => r.score == null).length;

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiStar size={14} /> Ranking de proveedores</span>
        <span className="fin-widget-sub">{rows.length} activos</span>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && (
        topSuppliers.length === 0 ? (
          <div className="fin-widget-empty">
            Sin historial suficiente para rankear proveedores.
          </div>
        ) : (
          <>
            <div className="fin-budget-rows">
              {topSuppliers.map(s => (
                <div key={s.supplierId} className="fin-budget-row">
                  <div className="fin-budget-row-head">
                    <span className="fin-budget-row-cat">{s.supplierName}</span>
                    <span className="fin-budget-row-pct" style={{ color: scoreColor(s.score) }}>
                      {s.score != null ? s.score.toFixed(0) : '—'}
                    </span>
                  </div>
                  <span className="fin-widget-sub" style={{ gridColumn: '1 / -1' }}>
                    {s.orderCount || 0} OCs
                    {s.avgLeadTimeDays != null && ` · ${s.avgLeadTimeDays.toFixed(1)}d lead`}
                    {s.fillRate != null && ` · fill ${(s.fillRate * 100).toFixed(0)}%`}
                  </span>
                </div>
              ))}
            </div>
            {withoutHistory > 0 && (
              <div className="fin-widget-sub" style={{ fontSize: '0.75rem' }}>
                {withoutHistory} proveedor(es) sin historial suficiente.
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}

export default SupplierRankingWidget;
