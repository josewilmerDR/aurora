import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FiBarChart2, FiPlus } from 'react-icons/fi';
import { formatMoney, formatPct, currentMonthRange, FUNCTIONAL_CURRENCY } from '../../lib/format';
import { useFinanceResource } from '../../hooks/useFinanceResource';
import WidgetSkeleton from './WidgetSkeleton';
import WidgetError from './WidgetError';

function RoiWidget() {
  const { desde, hasta } = useMemo(currentMonthRange, []);
  const { data, loading, error, reload } = useFinanceResource(
    `/api/roi/live?desde=${desde}&hasta=${hasta}`,
    { errorMessage: 'No se pudo cargar la rentabilidad.' }
  );

  // Lotes con al menos algo de actividad (ingreso o costo > 0).
  const active = (data?.porLote || []).filter(r => r.ingresos > 0 || r.costos > 0);
  const sorted = [...active].sort((a, b) => b.margen - a.margen);
  const top = sorted.slice(0, 3);
  // "Peores" = los 3 del fondo, SIEMPRE disjuntos del top: arrancamos desde
  // el índice 3 para que ningún lote aparezca en ambas listas. Antes se usaba
  // slice(-3) sobre el total, que con 4–5 lotes solapaba con el top.
  const worst = sorted.length > 3 ? sorted.slice(3).slice(-3).reverse() : [];
  const shown = top.length + worst.length;
  const hiddenLotes = active.length - shown;

  const resumen = data?.resumen;

  const renderItem = (r) => (
    <div key={r.loteId} className="fin-roi-item">
      <span className="fin-roi-item-name">{r.loteNombre}</span>
      <span className={`fin-roi-item-value${r.margen < 0 ? ' fin-widget-primary--negative' : ''}`}>
        {formatMoney(r.margen)} · {formatPct(r.margenPct)}
      </span>
    </div>
  );

  // Empty state: borde dasheado + bg sutil (C1).
  const isEmptyState = !loading && !error && data && active.length === 0;
  const sectionCls = `aur-section${isEmptyState ? ' fin-widget--empty' : ''}`;

  return (
    <section className={sectionCls}>
      <div className="aur-section-header">
        <span className="aur-section-num"><FiBarChart2 size={14} /></span>
        <h3 className="aur-section-title">Rentabilidad</h3>
        <span className="aur-section-count">Mes actual</span>
        {!isEmptyState && (
          <Link className="fin-widget-header-cta aur-touch-target" to="/costos">
            Ver Centro de Costos →
          </Link>
        )}
      </div>

      {loading && <WidgetSkeleton label="Cargando rentabilidad…" />}
      {error && <WidgetError message={error} onRetry={reload} />}

      {!loading && !error && data && (
        <>
          <div className="fin-widget-stats">
            <div>
              <span>Margen total</span>
              <strong className={resumen?.margen < 0 ? 'fin-widget-primary--negative' : ''}>
                {formatMoney(resumen?.margen, FUNCTIONAL_CURRENCY)}
              </strong>
            </div>
            <div>
              <span>Margen %</span>
              <strong className={resumen?.margen < 0 ? 'fin-widget-primary--negative' : ''}>
                {formatPct(resumen?.margenPct)}
              </strong>
            </div>
          </div>

          {active.length === 0 ? (
            <div className="fin-widget-empty-state">
              <FiBarChart2 size={28} className="fin-widget-empty-icon" />
              <p className="fin-widget-empty-text">
                Sin ingresos ni costos registrados este mes.
              </p>
              <Link
                to="/finance/ingresos"
                className="aur-btn-pill aur-btn-pill--sm fin-widget-empty-cta"
              >
                <FiPlus size={12} /> Registrar ingreso
              </Link>
            </div>
          ) : (
            <>
              <div className="fin-roi-section">
                <span className="fin-roi-section-title">Mejores lotes</span>
                {top.map(renderItem)}
              </div>

              {worst.length > 0 && (
                <div className="fin-roi-section">
                  <span className="fin-roi-section-title">Peores lotes</span>
                  {worst.map(renderItem)}
                </div>
              )}

              {hiddenLotes > 0 && (
                <Link to="/costos" className="fin-commits-more">
                  +{hiddenLotes} lotes más
                </Link>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export default RoiWidget;
