import { useEffect, useState } from 'react';
import { FiPackage } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useApiFetch } from '../../../hooks/useApiFetch';

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

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiPackage size={14} /> Catálogo de crédito</span>
        <span className="fin-widget-sub">{products.length ? `${products.length} activos` : ''}</span>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && (
        <>
          {products.length === 0 ? (
            <div className="fin-widget-empty">
              Aún no hay productos de crédito cargados. Agrégalos desde la sección "Catálogo" para poder simular y analizar elegibilidad.
            </div>
          ) : (
            <>
              <div className="fin-recent-list">
                {top.map(p => (
                  <div key={p.id} className="fin-recent-row">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <strong>{p.providerName}</strong>
                      <span className="fin-widget-sub">
                        {TIPO_LABELS[p.tipo] || p.tipo} · APR {fmtPct(p.aprMin)}–{fmtPct(p.aprMax)}
                      </span>
                    </div>
                    <span className="fin-recent-tag">{p.plazoMesesMin}-{p.plazoMesesMax}m</span>
                  </div>
                ))}
              </div>
              <Link
                to="/finance/financing/catalog"
                className="btn btn-secondary"
                style={{ marginTop: 'auto', textAlign: 'center' }}
              >
                Ver catálogo completo
              </Link>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default CreditCatalogWidget;
