import { useEffect, useState } from 'react';
import { FiSend } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useApiFetch } from '../../../hooks/useApiFetch';

// Open RFQs overview. Clicking any row takes the user to the RFQs list
// where responses can be logged and the RFQ closed.

function RfqsWidget() {
  const apiFetch = useApiFetch();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/api/rfqs?estado=sent&limit=20')
      .then(r => r.json())
      .then(data => setRows(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudieron cargar las cotizaciones.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const openCount = rows.length;
  const pendingResponses = rows.reduce((sum, r) => {
    const contacted = Array.isArray(r.suppliersContacted) ? r.suppliersContacted.length : 0;
    const responded = Array.isArray(r.responses) ? r.responses.length : 0;
    return sum + Math.max(0, contacted - responded);
  }, 0);

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiSend size={14} /> Cotizaciones abiertas</span>
        <Link to="/procurement/rfqs" className="fin-widget-sub" style={{ textDecoration: 'underline' }}>
          Ver todos
        </Link>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && (
        <>
          <div className="fin-widget-stats">
            <div>
              <span>Abiertos</span>
              <strong>{openCount}</strong>
            </div>
            <div>
              <span>Sin responder</span>
              <strong className={pendingResponses > 0 ? 'fin-widget-primary--negative' : ''}>
                {pendingResponses}
              </strong>
            </div>
          </div>

          {openCount === 0 ? (
            <div className="fin-widget-empty">Sin cotizaciones en curso.</div>
          ) : (
            <div className="fin-budget-rows">
              {rows.slice(0, 5).map(r => {
                const contacted = Array.isArray(r.suppliersContacted) ? r.suppliersContacted.length : 0;
                const responded = Array.isArray(r.responses) ? r.responses.length : 0;
                return (
                  <Link
                    key={r.id}
                    to="/procurement/rfqs"
                    className="fin-budget-row"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div className="fin-budget-row-head">
                      <span className="fin-budget-row-cat">{r.nombreComercial || r.productoId}</span>
                      <span className="fin-budget-row-pct">{responded}/{contacted}</span>
                    </div>
                    <span className="fin-widget-sub" style={{ gridColumn: '1 / -1' }}>
                      {r.cantidad} {r.unidad} · cierre {r.deadline}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default RfqsWidget;
