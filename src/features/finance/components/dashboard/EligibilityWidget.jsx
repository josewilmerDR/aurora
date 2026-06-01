import { FiCheckSquare } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useFinanceResource } from '../../hooks/useFinanceResource';
import { formatMoney } from '../../lib/format';
import { formatShortDate } from '../../../../lib/formatDate';
import WidgetSkeleton from './WidgetSkeleton';
import WidgetError from './WidgetError';

const SCORE_BADGE_VARIANT = {
  ok:   { label: 'Elegible',    cls: 'aur-badge--green' },
  warn: { label: 'Revisar',     cls: 'aur-badge--yellow' },
  bad:  { label: 'No elegible', cls: 'aur-badge--gray' },
};

function scoreBadge(score) {
  if (score == null) return null;
  if (score >= 0.75) return SCORE_BADGE_VARIANT.ok;
  if (score >= 0.5)  return SCORE_BADGE_VARIANT.warn;
  return SCORE_BADGE_VARIANT.bad;
}

function EligibilityWidget() {
  const { data, loading, error, reload } = useFinanceResource(
    '/api/financing/eligibility',
    { errorMessage: 'No se pudieron cargar los análisis.' }
  );
  const analyses = Array.isArray(data) ? data : [];
  const top = analyses.slice(0, 5);

  const isEmptyState = !loading && !error && analyses.length === 0;
  const sectionCls = `aur-section${isEmptyState ? ' fin-widget--empty' : ''}`;

  return (
    <section className={sectionCls}>
      <div className="aur-section-header">
        <span className="aur-section-num"><FiCheckSquare size={14} aria-hidden="true" /></span>
        <h3 className="aur-section-title">Análisis de elegibilidad</h3>
        {analyses.length > 0 && <span className="aur-section-count">{analyses.length} recientes</span>}
      </div>

      {loading && <WidgetSkeleton label="Cargando análisis de elegibilidad…" />}
      {error && <WidgetError message={error} onRetry={reload} />}

      {!loading && !error && (
        <>
          {analyses.length === 0 ? (
            <div className="fin-widget-empty-state">
              <FiCheckSquare size={28} className="fin-widget-empty-icon" />
              <p className="fin-widget-empty-text">
                Sin análisis aún. La elegibilidad se calcula sobre un snapshot
                financiero: generá tu perfil para poder evaluarla.
              </p>
              <Link
                to="/finance/financing"
                className="aur-btn-pill aur-btn-pill--sm fin-widget-empty-cta aur-touch-target"
              >
                Ir al perfil financiero
              </Link>
            </div>
          ) : (
            <>
              <div className="fin-recent-list">
                {top.map((a) => {
                  const badge = scoreBadge(a.topScore);
                  return (
                    <Link
                      key={a.id}
                      to={`/finance/financing/snapshots/${a.snapshotId}`}
                      className="fin-recent-row fin-recent-row--link"
                    >
                      <div className="fin-recent-row-text">
                        <strong>{formatMoney(a.targetAmount)}</strong>
                        <span className="fin-widget-sub">
                          {a.targetUse || 'sin uso especificado'} · {formatShortDate(a.createdAt)}
                        </span>
                      </div>
                      {badge && (
                        <span className={`aur-badge ${badge.cls}`}>
                          {badge.label} · {(a.topScore * 100).toFixed(0)}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
              {analyses.length > top.length && (
                <div className="fin-commits-more">+{analyses.length - top.length} análisis más</div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export default EligibilityWidget;
