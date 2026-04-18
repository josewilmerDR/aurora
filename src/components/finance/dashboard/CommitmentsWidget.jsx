import { useEffect, useState } from 'react';
import { FiCalendar } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

const fmt = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

// "2026-04-22" → "22 abr"
const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  } catch {
    return iso;
  }
};

function CommitmentsWidget() {
  const apiFetch = useApiFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Horizonte corto (4 semanas) — es lo que queremos ver como "próximas".
    apiFetch('/api/treasury/projection?weeks=4')
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('No se pudieron cargar los compromisos.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  // Aplanamos todos los outflows de las 4 semanas en una sola lista
  // ordenada por fecha. Top 8 para mantener la tarjeta compacta.
  const outflows = [];
  for (const w of data?.series || []) {
    for (const ev of w.outflows || []) outflows.push(ev);
  }
  outflows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const top = outflows.slice(0, 8);

  const totalOutflows = outflows.reduce((s, ev) => s + (Number(ev.amount) || 0), 0);

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiCalendar size={14} /> Compromisos próximos</span>
        <span className="fin-widget-sub">4 semanas</span>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && data && (
        <>
          {outflows.length > 0 && (
            <div className="fin-widget-stats">
              <div>
                <span>Total salidas</span>
                <strong className="fin-widget-primary--negative">{fmt(totalOutflows)}</strong>
              </div>
              <div>
                <span>Eventos</span>
                <strong>{outflows.length}</strong>
              </div>
            </div>
          )}

          {top.length === 0 ? (
            <div className="fin-widget-empty">
              Sin salidas programadas en las próximas 4 semanas.
            </div>
          ) : (
            <div className="fin-commits-list">
              {top.map((ev, i) => (
                <div key={i} className="fin-commit-item">
                  <span className="fin-commit-date">{fmtDate(ev.date)}</span>
                  <span className="fin-commit-label" title={ev.source}>{ev.label}</span>
                  <span className="fin-commit-amount">{fmt(ev.amount)}</span>
                </div>
              ))}
              {outflows.length > top.length && (
                <div className="fin-widget-sub" style={{ textAlign: 'center', marginTop: 4 }}>
                  +{outflows.length - top.length} más
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CommitmentsWidget;
