import { useEffect, useState } from 'react';
import { FiPackage } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useApiFetch } from '../../../../hooks/useApiFetch';

const TIPO_LABELS = {
  agricola: 'Agrícola',
  capital_trabajo: 'Capital trabajo',
  leasing: 'Leasing',
  rotativo: 'Rotativo',
};

const fmtPct = (decimal) => {
  if (decimal == null) return '—';
  return `${(Number(decimal) * 100).toFixed(1)}%`;
};

function CreditCatalogWidget() {
  const apiFetch = useApiFetch();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/api/financing/credit-products?activo=true')
      .then(r => r.json())
      .then(data => setProducts(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudo cargar el catálogo.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const top = products.slice(0, 5);

  const fmtRange = (min, max, suffix = '') => {
    if (min === max) return `${fmtPct(min)}${suffix}`;
    return `${fmtPct(min)}–${fmtPct(max)}${suffix}`;
  };
  const fmtPlazo = (min, max) => (min === max ? `${min}m` : `${min}-${max}m`);

  return (
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiPackage size={14} /></span>
        <h3 className="aur-section-title">Ofertas de crédito</h3>
        {products.length ? <span className="aur-section-count">{products.length} activas</span> : null}
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-error">{error}</div>}

      {!loading && !error && (
        <>
          {products.length === 0 ? (
            <>
              <div className="fin-widget-empty">
                Aún no hay ofertas registradas. Ingresá las cotizaciones que hayas recibido de bancos o cooperativas.
              </div>
              <div className="fin-widget-cta-row">
                <Link to="/finance/financing/ofertas" className="aur-btn-pill">
                  Registrar ofertas
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="fin-recent-list">
                {top.map(p => (
                  <div key={p.id} className="fin-recent-row">
                    <div className="fin-recent-row-text">
                      <strong>{p.providerName}</strong>
                      <span className="fin-widget-sub">
                        {TIPO_LABELS[p.tipo] || p.tipo} · APR {fmtRange(p.aprMin, p.aprMax)}
                      </span>
                    </div>
                    <span className="aur-badge aur-badge--gray">{fmtPlazo(p.plazoMesesMin, p.plazoMesesMax)}</span>
                  </div>
                ))}
              </div>
              <div className="fin-widget-cta-row">
                <Link to="/finance/financing/ofertas" className="aur-btn-text">
                  Ver todas las ofertas
                </Link>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export default CreditCatalogWidget;
