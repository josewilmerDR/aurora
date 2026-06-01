import { FiPackage } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useFinanceResource } from '../../hooks/useFinanceResource';
import { formatPct } from '../../lib/format';
import WidgetSkeleton from './WidgetSkeleton';
import WidgetError from './WidgetError';

const TIPO_LABELS = {
  agricola: 'Agrícola',
  capital_trabajo: 'Capital trabajo',
  leasing: 'Leasing',
  rotativo: 'Rotativo',
};

// APR llega como decimal (0.1 = 10%); formatPct espera el valor ya en %.
const pct = (decimal) => formatPct(decimal == null ? null : Number(decimal) * 100);

// Rango de APR tolerando un extremo nulo (antes "10.0%–—" / "undefined").
function fmtRange(min, max) {
  if (min == null && max == null) return '—';
  if (min == null) return pct(max);
  if (max == null) return pct(min);
  return min === max ? pct(min) : `${pct(min)}–${pct(max)}`;
}

function fmtPlazo(min, max) {
  if (min == null && max == null) return '—';
  if (min == null) return `${max}m`;
  if (max == null) return `${min}m`;
  return min === max ? `${min}m` : `${min}-${max}m`;
}

function CreditCatalogWidget() {
  const { data, loading, error, reload } = useFinanceResource(
    '/api/financing/credit-products?activo=true',
    { errorMessage: 'No se pudo cargar el catálogo.' }
  );
  const products = Array.isArray(data) ? data : [];
  const top = products.slice(0, 5);

  const isEmptyState = !loading && !error && products.length === 0;
  const sectionCls = `aur-section${isEmptyState ? ' fin-widget--empty' : ''}`;

  return (
    <section className={sectionCls}>
      <div className="aur-section-header">
        <span className="aur-section-num"><FiPackage size={14} aria-hidden="true" /></span>
        <h3 className="aur-section-title">Ofertas de crédito</h3>
        {products.length > 0 && <span className="aur-section-count">{products.length} activas</span>}
        {!isEmptyState && (
          <Link className="fin-widget-header-cta aur-touch-target" to="/finance/financing/ofertas">
            Ver todas →
          </Link>
        )}
      </div>

      {loading && <WidgetSkeleton label="Cargando catálogo de crédito…" />}
      {error && <WidgetError message={error} onRetry={reload} />}

      {!loading && !error && (
        <>
          {products.length === 0 ? (
            <div className="fin-widget-empty-state">
              <FiPackage size={28} className="fin-widget-empty-icon" />
              <p className="fin-widget-empty-text">
                Aún no hay ofertas registradas. Ingresá las cotizaciones que
                hayas recibido de bancos o cooperativas.
              </p>
              <Link
                to="/finance/financing/ofertas"
                className="aur-btn-pill aur-btn-pill--sm fin-widget-empty-cta aur-touch-target"
              >
                Registrar ofertas
              </Link>
            </div>
          ) : (
            <div className="fin-recent-list">
              {top.map((p) => (
                <Link
                  key={p.id}
                  to="/finance/financing/ofertas"
                  className="fin-recent-row fin-recent-row--link"
                >
                  <div className="fin-recent-row-text">
                    <strong>{p.providerName}</strong>
                    <span className="fin-widget-sub">
                      {TIPO_LABELS[p.tipo] || p.tipo} · APR {fmtRange(p.aprMin, p.aprMax)}
                    </span>
                  </div>
                  <span className="aur-badge aur-badge--gray">{fmtPlazo(p.plazoMesesMin, p.plazoMesesMax)}</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default CreditCatalogWidget;
