import { FiTrendingUp, FiTrendingDown } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useFinanceResource } from '../../hooks/useFinanceResource';
import { formatMoney } from '../../lib/format';
import { formatShortDate } from '../../../../lib/formatDate';
import WidgetSkeleton from './WidgetSkeleton';
import WidgetError from './WidgetError';

const RECOMMENDATION_BADGE_VARIANT = {
  tomar:             { label: 'Tomar',       cls: 'aur-badge--green' },
  tomar_condicional: { label: 'Condicional', cls: 'aur-badge--yellow' },
  no_tomar:          { label: 'No tomar',    cls: 'aur-badge--gray' },
};

function DebtSimulationsWidget() {
  const { data, loading, error, reload } = useFinanceResource(
    '/api/financing/debt-simulations',
    { errorMessage: 'No se pudieron cargar las simulaciones.' }
  );
  const sims = Array.isArray(data) ? data : [];
  const top = sims.slice(0, 5);

  const isEmptyState = !loading && !error && sims.length === 0;
  const sectionCls = `aur-section${isEmptyState ? ' fin-widget--empty' : ''}`;

  return (
    <section className={sectionCls}>
      <div className="aur-section-header">
        <span className="aur-section-num"><FiTrendingUp size={14} aria-hidden="true" /></span>
        <h3 className="aur-section-title">Simulaciones de deuda</h3>
        {sims.length > 0 && <span className="aur-section-count">{sims.length} recientes</span>}
        {!isEmptyState && (
          <Link className="fin-widget-header-cta aur-touch-target" to="/finance/financing/simulations">
            Ver todas →
          </Link>
        )}
      </div>

      {loading && <WidgetSkeleton label="Cargando simulaciones de deuda…" />}
      {error && <WidgetError message={error} onRetry={reload} />}

      {!loading && !error && (
        <>
          {sims.length === 0 ? (
            <div className="fin-widget-empty-state">
              <FiTrendingUp size={28} className="fin-widget-empty-icon" />
              <p className="fin-widget-empty-text">
                Sin simulaciones. Elegí una oferta registrada y corré Monte Carlo
                contra el perfil financiero para ver el impacto en tu margen.
              </p>
              <Link
                to="/finance/financing/simulations"
                className="aur-btn-pill aur-btn-pill--sm fin-widget-empty-cta aur-touch-target"
              >
                Nueva simulación
              </Link>
            </div>
          ) : (
            <div className="fin-recent-list">
              {top.map((s) => {
                const rec = RECOMMENDATION_BADGE_VARIANT[s.recommendation] || null;
                const positive = Number(s.marginDelta) >= 0;
                return (
                  <Link
                    key={s.id}
                    to="/finance/financing/simulations"
                    className="fin-recent-row fin-recent-row--link"
                  >
                    <div className="fin-recent-row-text">
                      <strong>{formatMoney(s.amount)} · {s.plazoMeses}m</strong>
                      <span className="fin-widget-sub">
                        {s.providerName || 'Oferta sin nombre'} · {formatShortDate(s.createdAt)}
                      </span>
                    </div>
                    <div className="fin-recent-row-trail">
                      <span className={`fin-recent-row-delta${positive ? '' : ' fin-recent-row-delta--negative'}`}>
                        {positive
                          ? <FiTrendingUp size={12} aria-hidden="true" />
                          : <FiTrendingDown size={12} aria-hidden="true" />} {formatMoney(s.marginDelta)}
                      </span>
                      {rec && <span className={`aur-badge ${rec.cls}`}>{rec.label}</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default DebtSimulationsWidget;
