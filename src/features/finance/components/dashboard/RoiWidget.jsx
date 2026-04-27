import { useEffect, useState, useMemo } from 'react';
import { FiBarChart2 } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

const fmt = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);

// Rango: desde el primer día del mes actual hasta hoy. Consistente con el
// período que se muestra en BudgetWidget.
function currentMonthRange() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const today = d.toISOString().slice(0, 10);
  return { desde: `${y}-${m}-01`, hasta: today };
}

function RoiWidget() {
  const apiFetch = useApiFetch();
  const { desde, hasta } = useMemo(currentMonthRange, []);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch(`/api/roi/live?desde=${desde}&hasta=${hasta}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('No se pudo cargar la rentabilidad.'))
      .finally(() => setLoading(false));
  }, [apiFetch, desde, hasta]);

  // Filtramos lotes con al menos algo de actividad (ingreso o costo > 0).
  const active = (data?.porLote || []).filter(r => r.ingresos > 0 || r.costos > 0);
  const sorted = [...active].sort((a, b) => b.margen - a.margen);
  const top = sorted.slice(0, 3);
  // Solo mostramos "peores" si hay al menos 4 lotes, para no mostrar
  // duplicados con "mejores".
  const worst = sorted.length > 3 ? sorted.slice(-3).reverse() : [];

  const renderItem = (r) => (
    <div key={r.loteId} className="fin-roi-item">
      <span className="fin-roi-item-name">{r.loteNombre}</span>
      <span className={`fin-roi-item-value${r.margen < 0 ? ' fin-widget-primary--negative' : ''}`}>
        {fmt(r.margen)} · {fmtPct(r.margenPct)}
      </span>
    </div>
  );

  return (
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiBarChart2 size={14} /></span>
        <h3 className="aur-section-title">Rentabilidad</h3>
        <span className="aur-section-count">Mes actual</span>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-error">{error}</div>}

      {!loading && !error && data && (
        <>
          <div className="fin-widget-stats">
            <div>
              <span>Margen total</span>
              <strong className={data.resumen.margen < 0 ? 'fin-widget-primary--negative' : ''}>
                {fmt(data.resumen.margen)}
              </strong>
            </div>
            <div>
              <span>Margen %</span>
              <strong className={data.resumen.margen < 0 ? 'fin-widget-primary--negative' : ''}>
                {fmtPct(data.resumen.margenPct)}
              </strong>
            </div>
          </div>

          {active.length === 0 ? (
            <div className="fin-widget-empty">Sin actividad en el mes actual.</div>
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
            </>
          )}
        </>
      )}
    </section>
  );
}

export default RoiWidget;
