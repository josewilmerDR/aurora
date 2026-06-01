import { useState } from 'react';
import { FiFileText, FiRefreshCw } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useToast } from '../../../../contexts/ToastContext';
import { useApiFetch } from '../../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../../contexts/UserContext';
import { useFinanceResource } from '../../hooks/useFinanceResource';
import { formatMoney, FUNCTIONAL_CURRENCY } from '../../lib/format';
import { formatShortDate } from '../../../../lib/formatDate';
import WidgetSkeleton from './WidgetSkeleton';
import WidgetError from './WidgetError';

// Widget del perfil financiero. Muestra los últimos snapshots inmutables y, para
// administrador, permite generar uno nuevo. El detalle de cada snapshot vive en
// /finance/financing/snapshots/:id (SnapshotDetail).
function FinancialProfileWidget() {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const { currentUser } = useUser();
  const canGenerate = hasMinRole(currentUser?.rol || 'trabajador', 'administrador');

  const { data, loading, error, reload } = useFinanceResource(
    '/api/financing/profile/snapshots',
    { errorMessage: 'No se pudieron cargar los snapshots.' }
  );
  const snapshots = Array.isArray(data) ? data : [];
  const latest = snapshots[0];

  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      // El error de esta acción va a un toast, NO al error de carga: así un
      // fallo transitorio no desmonta la lista ni el botón (el usuario puede
      // reintentar sin recargar la página).
      const res = await apiFetch('/api/financing/profile/snapshot', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error();
      toast.success('Snapshot generado.');
      reload();
    } catch {
      toast.error('No se pudo generar el snapshot.');
    } finally {
      setGenerating(false);
    }
  };

  const isEmptyState = !loading && !error && snapshots.length === 0;
  const sectionCls = `aur-section${isEmptyState ? ' fin-widget--empty' : ''}`;

  return (
    <section className={sectionCls}>
      <div className="aur-section-header">
        <span className="aur-section-num"><FiFileText size={14} aria-hidden="true" /></span>
        <h3 className="aur-section-title">Perfil financiero</h3>
        {snapshots.length > 0 && (
          <span className="aur-section-count">{snapshots.length} cortes</span>
        )}
        {latest && (
          <Link
            className="fin-widget-header-cta aur-touch-target"
            to={`/finance/financing/snapshots/${latest.id}`}
          >
            Ver último →
          </Link>
        )}
      </div>

      {loading && <WidgetSkeleton label="Cargando perfil financiero…" />}
      {error && <WidgetError message={error} onRetry={reload} />}

      {!loading && !error && (
        <>
          {latest ? (
            <>
              <div>
                <div className="fin-widget-primary">{formatMoney(latest.totalAssets, FUNCTIONAL_CURRENCY)}</div>
                <div className="fin-widget-sub">Activos totales — corte {formatShortDate(latest.asOf)}</div>
              </div>
              <div className="fin-widget-stats">
                <div>
                  <span>Patrimonio</span>
                  <strong>{formatMoney(latest.totalEquity)}</strong>
                </div>
                <div>
                  <span>Revenue 12m</span>
                  <strong>{formatMoney(latest.revenue)}</strong>
                </div>
              </div>
              <div className="fin-recent-list">
                {snapshots.slice(0, 3).map((s) => (
                  <Link
                    key={s.id}
                    to={`/finance/financing/snapshots/${s.id}`}
                    className="fin-recent-row fin-recent-row--link"
                  >
                    <span>{formatShortDate(s.generatedAt)}</span>
                    <span className="aur-badge aur-badge--gray">corte {formatShortDate(s.asOf)}</span>
                  </Link>
                ))}
              </div>

              {canGenerate && (
                <div className="fin-widget-cta-row">
                  <button
                    type="button"
                    className="aur-btn-pill aur-touch-target"
                    onClick={handleGenerate}
                    disabled={generating}
                    aria-busy={generating}
                  >
                    <FiRefreshCw size={14} aria-hidden="true" /> {generating ? 'Generando…' : 'Generar snapshot'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="fin-widget-empty-state">
              <FiFileText size={28} className="fin-widget-empty-icon" />
              <p className="fin-widget-empty-text">
                Aún no hay snapshots. Generá el primero para tener un corte
                financiero auditable que alimente todo el análisis.
              </p>
              {canGenerate && (
                <button
                  type="button"
                  className="aur-btn-pill aur-btn-pill--sm fin-widget-empty-cta aur-touch-target"
                  onClick={handleGenerate}
                  disabled={generating}
                  aria-busy={generating}
                >
                  <FiRefreshCw size={12} aria-hidden="true" /> {generating ? 'Generando…' : 'Generar snapshot'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default FinancialProfileWidget;
