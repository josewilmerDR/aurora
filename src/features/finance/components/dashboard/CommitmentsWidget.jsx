import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiCalendar } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';
import WidgetSkeleton from './WidgetSkeleton';

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

  // Empty state: borde dasheado + bg sutil (C1).
  const isEmptyState = !loading && !error && data && top.length === 0;
  const sectionCls = `aur-section${isEmptyState ? ' fin-widget--empty' : ''}`;

  return (
    <section className={sectionCls}>
      <div className="aur-section-header">
        <span className="aur-section-num"><FiCalendar size={14} /></span>
        <h3 className="aur-section-title">Compromisos próximos</h3>
        <span className="aur-section-count">4 semanas</span>
        {!isEmptyState && (
          <Link className="fin-widget-header-cta" to="/finance/tesoreria">
            Ver Tesorería →
          </Link>
        )}
      </div>

      {loading && <WidgetSkeleton label="Cargando compromisos próximos…" />}
      {error && <div className="fin-widget-error">{error}</div>}

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
            <div className="fin-widget-empty-state">
              <FiCalendar size={28} className="fin-widget-empty-icon" />
              <p className="fin-widget-empty-text">
                Sin salidas programadas en las próximas 4 semanas.
              </p>
              <Link
                to="/finance/tesoreria"
                className="aur-btn-pill aur-btn-pill--sm fin-widget-empty-cta"
              >
                Abrir Tesorería
              </Link>
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
                <div className="fin-commits-more">+{outflows.length - top.length} más</div>
              )}
            </div>
          )}
        </>
      )}

      {/* CTA secundaria movida al header (top-right, ver C3). */}
    </section>
  );
}

export default CommitmentsWidget;
