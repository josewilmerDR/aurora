import { Link } from 'react-router-dom';
import { FiCalendar } from 'react-icons/fi';
import { formatMoney, formatDateShort } from '../../lib/format';
import WidgetSkeleton from './WidgetSkeleton';
import WidgetError from './WidgetError';

// Horizonte corto de "próximos compromisos": las primeras 4 semanas de la
// proyección. Antes este widget pedía su propia /treasury/projection?weeks=4;
// ahora reusa la proyección de 12 semanas que ya fetchea la página (CashWidget
// comparte el mismo response) y la recorta acá. Una llamada menos al endpoint.
const HORIZON_WEEKS = 4;

// Moneda del horizonte = la del saldo registrado (igual que Caja). Si aún no
// hay saldo, no habrá outflows que mostrar, así que el fallback no se ve.
function CommitmentsWidget({ data, loading, error, reload }) {
  const currency = data?.startingBalanceSource?.currency || 'USD';

  // Aplanamos los outflows de las primeras 4 semanas en una lista ordenada
  // por fecha. Top 8 para mantener la tarjeta compacta.
  const outflows = [];
  for (const w of (data?.series || []).slice(0, HORIZON_WEEKS)) {
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
          <Link className="fin-widget-header-cta aur-touch-target" to="/finance/tesoreria">
            Ver Tesorería →
          </Link>
        )}
      </div>

      {loading && <WidgetSkeleton label="Cargando compromisos próximos…" />}
      {error && <WidgetError message={error} onRetry={reload} />}

      {!loading && !error && data && (
        <>
          {outflows.length > 0 && (
            <div className="fin-widget-stats">
              <div>
                <span>Total salidas</span>
                <strong className="fin-widget-primary--negative">{formatMoney(totalOutflows, currency)}</strong>
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
              {top.map((ev) => (
                <div
                  key={`${ev.date}|${ev.label}|${ev.amount}`}
                  className="fin-commit-item"
                  title={ev.source || undefined}
                >
                  <span className="fin-commit-date">{formatDateShort(ev.date)}</span>
                  <span className="fin-commit-label">{ev.label}</span>
                  {/* Sin prefijo de moneda por fila: la unidad ya la fija el
                      stat "Total salidas" del header. Evita repetir "CRC" ×8. */}
                  <span className="fin-commit-amount">{formatMoney(ev.amount)}</span>
                </div>
              ))}
              {outflows.length > top.length && (
                <div className="fin-commits-more">+{outflows.length - top.length} más</div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default CommitmentsWidget;
