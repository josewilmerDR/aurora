import { useEffect, useState } from 'react';
import { FiStar } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

// Score → aur-badge variant.
function scoreVariant(score) {
  if (score == null) return 'aur-badge--gray';
  if (score >= 75) return 'aur-badge--green';
  if (score >= 50) return 'aur-badge--yellow';
  return 'aur-badge--magenta';
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
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiStar size={14} /></span>
        <h3 className="aur-section-title">Ranking de proveedores</h3>
        <span className="aur-section-count">{rows.length}</span>
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
                    <span className={`aur-badge ${scoreVariant(s.score)}`}>
                      {s.score != null ? s.score.toFixed(0) : '—'}
                    </span>
                  </div>
                  <span className="fin-widget-sub">
                    {s.orderCount || 0} OCs
                    {s.avgLeadTimeDays != null && ` · ${s.avgLeadTimeDays.toFixed(1)}d lead`}
                    {s.fillRate != null && ` · fill ${(s.fillRate * 100).toFixed(0)}%`}
                  </span>
                </div>
              ))}
            </div>
            {withoutHistory > 0 && (
              <div className="fin-widget-sub fin-widget-footer">
                {withoutHistory} proveedor(es) sin historial suficiente.
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}

export default SupplierRankingWidget;
