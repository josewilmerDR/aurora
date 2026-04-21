import { useEffect, useState } from 'react';
import { FiTrendingUp, FiTrendingDown } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useApiFetch } from '../../../hooks/useApiFetch';

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

const RECOMMENDATION_LABELS = {
  tomar: { label: 'Tomar', cls: 'fin-badge--ok' },
  tomar_condicional: { label: 'Condicional', cls: 'fin-badge--warn' },
  no_tomar: { label: 'No tomar', cls: 'fin-badge--bad' },
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
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiTrendingUp size={14} /> Simulaciones de deuda</span>
        <span className="fin-widget-sub">{sims.length ? `${sims.length} recientes` : ''}</span>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && (
        <>
          {top.length === 0 ? (
            <div className="fin-widget-empty" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span>Sin simulaciones. Elegí una oferta registrada y corré Monte Carlo contra el perfil financiero.</span>
              <Link
                to="/finance/financing/simulaciones"
                className="btn btn-secondary"
                style={{ textAlign: 'center' }}
              >
                Nueva simulación
              </Link>
            </div>
          ) : (
            <>
              <div className="fin-recent-list">
                {top.map(s => {
                  const rec = RECOMMENDATION_LABELS[s.recommendation] || null;
                  const positive = Number(s.marginDelta) >= 0;
                  return (
                    <Link
                      key={s.id}
                      to="/finance/financing/simulaciones"
                      className="fin-recent-row fin-recent-row--link"
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <strong>{fmtMoney(s.amount)} · {s.plazoMeses}m</strong>
                        <span className="fin-widget-sub">
                          {s.providerName || 'producto ' + (s.creditProductId || '').slice(0, 6)} · {fmtDate(s.createdAt)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={positive ? 'fin-widget-primary' : 'fin-widget-primary--negative'}
                              style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                          {positive ? <FiTrendingUp size={12} /> : <FiTrendingDown size={12} />} {fmtMoney(s.marginDelta)}
                        </span>
                        {rec && <span className={`fin-badge ${rec.cls}`}>{rec.label}</span>}
                      </div>
                    </Link>
                  );
                })}
              </div>
              <Link
                to="/finance/financing/simulaciones"
                className="btn btn-secondary"
                style={{ marginTop: 'auto', textAlign: 'center' }}
              >
                Ver todas / nueva simulación
              </Link>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default DebtSimulationsWidget;
