import { useEffect, useState } from 'react';
import { FiTrendingUp, FiTrendingDown } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useApiFetch } from '../../../../hooks/useApiFetch';

const fmtMoney = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  } catch { return iso; }
};

const RECOMMENDATION_BADGE_VARIANT = {
  tomar:             { label: 'Tomar',       cls: 'aur-badge--green' },
  tomar_condicional: { label: 'Condicional', cls: 'aur-badge--yellow' },
  no_tomar:          { label: 'No tomar',    cls: 'aur-badge--gray' },
};

function DebtSimulationsWidget() {
  const apiFetch = useApiFetch();
  const [sims, setSims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/api/financing/debt-simulations')
      .then(r => r.json())
      .then(data => setSims(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudieron cargar las simulaciones.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const top = sims.slice(0, 5);

  return (
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiTrendingUp size={14} /></span>
        <h3 className="aur-section-title">Simulaciones de deuda</h3>
        {sims.length ? <span className="aur-section-count">{sims.length} recientes</span> : null}
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-error">{error}</div>}

      {!loading && !error && (
        <>
          {top.length === 0 ? (
            <>
              <div className="fin-widget-empty">
                Sin simulaciones. Elegí una oferta registrada y corré Monte Carlo contra el perfil financiero.
              </div>
              <div className="fin-widget-cta-row">
                <Link to="/finance/financing/simulaciones" className="aur-btn-pill">
                  Nueva simulación
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="fin-recent-list">
                {top.map(s => {
                  const rec = RECOMMENDATION_BADGE_VARIANT[s.recommendation] || null;
                  const positive = Number(s.marginDelta) >= 0;
                  return (
                    <Link
                      key={s.id}
                      to="/finance/financing/simulaciones"
                      className="fin-recent-row fin-recent-row--link"
                    >
                      <div className="fin-recent-row-text">
                        <strong>{fmtMoney(s.amount)} · {s.plazoMeses}m</strong>
                        <span className="fin-widget-sub">
                          {s.providerName || 'producto ' + (s.creditProductId || '').slice(0, 6)} · {fmtDate(s.createdAt)}
                        </span>
                      </div>
                      <div className="fin-recent-row-trail">
                        <span className={`fin-recent-row-delta${positive ? '' : ' fin-recent-row-delta--negative'}`}>
                          {positive ? <FiTrendingUp size={12} /> : <FiTrendingDown size={12} />} {fmtMoney(s.marginDelta)}
                        </span>
                        {rec && <span className={`aur-badge ${rec.cls}`}>{rec.label}</span>}
                      </div>
                    </Link>
                  );
                })}
              </div>
              <div className="fin-widget-cta-row">
                <Link to="/finance/financing/simulaciones" className="aur-btn-text">
                  Ver todas / nueva simulación
                </Link>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export default DebtSimulationsWidget;
