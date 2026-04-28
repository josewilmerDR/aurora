import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiBarChart2, FiRefreshCw, FiFilter, FiList } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/strategy.css';

const fmtNumber = (n, digits = 0) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};
const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);
const fmtDias = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : `${n} d`);

// Rango por defecto: últimos 12 meses. Coherente con un horizonte estratégico
// inicial (no demasiado corto para diluir la señal).
function last12MonthsRange() {
  const today = new Date();
  const hasta = today.toISOString().slice(0, 10);
  const d = new Date(today);
  d.setMonth(d.getMonth() - 12);
  const desde = d.toISOString().slice(0, 10);
  return { desde, hasta };
}

const GROUP_OPTIONS = [
  { value: 'lote', label: 'Por lote' },
  { value: 'paquete', label: 'Por paquete' },
  { value: 'cultivo', label: 'Por cultivo' },
  { value: 'temporada', label: 'Por temporada' },
];

const numNegClass = (v) => (v != null && Number(v) < 0 ? 'strategy-num--neg' : '');
const numPosClass = (v) => (v != null && Number(v) > 0 ? 'strategy-num--pos' : '');

function YieldHistory() {
  const apiFetch = useApiFetch();
  const defaultRange = useMemo(last12MonthsRange, []);
  const [desde, setDesde] = useState(defaultRange.desde);
  const [hasta, setHasta] = useState(defaultRange.hasta);
  const [groupBy, setGroupBy] = useState('lote');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ desde, hasta, groupBy }).toString();
    apiFetch(`/api/analytics/yield?${qs}`)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.message || 'yield failed');
        return d;
      })
      .then(setData)
      .catch(e => setError(e.message || 'No se pudo cargar.'))
      .finally(() => setLoading(false));
  }, [apiFetch, desde, hasta, groupBy]);

  useEffect(() => { load(); }, [load]);

  const resumen = data?.resumen;
  const rows = data?.rows || [];
  const groupLabel = GROUP_OPTIONS.find(o => o.value === groupBy)?.label?.replace('Por ', '') || '';

  return (
    <div className="aur-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title"><FiBarChart2 /> Rendimiento Histórico</h2>
          <p className="aur-sheet-subtitle">
            Rendimiento físico y económico agregado por distintas dimensiones. Los costos e ingresos reutilizan
            la misma atribución que el ROI en vivo.
          </p>
        </div>
        <div className="aur-sheet-header-actions">
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={load}
            disabled={loading}
          >
            <FiRefreshCw size={14} /> {loading ? 'Cargando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiFilter size={14} /></span>
          <h3 className="aur-section-title">Filtros</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="yh-desde">Desde</label>
            <div className="aur-field">
              <input
                id="yh-desde"
                type="date"
                className="aur-input"
                value={desde}
                onChange={e => setDesde(e.target.value)}
              />
            </div>
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="yh-hasta">Hasta</label>
            <div className="aur-field">
              <input
                id="yh-hasta"
                type="date"
                className="aur-input"
                value={hasta}
                onChange={e => setHasta(e.target.value)}
              />
            </div>
          </div>
          <div className="aur-row aur-row--multiline">
            <span className="aur-row-label">Agrupar por</span>
            <div className="aur-field">
              <div className="strategy-chips-row">
                {GROUP_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`aur-chip${groupBy === opt.value ? '' : ' aur-chip--ghost'}`}
                    onClick={() => setGroupBy(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {error && <div className="aur-banner aur-banner--danger">{error}</div>}

      {resumen && (
        <div className="strategy-kpis">
          <div className="strategy-kpi">
            <span className="strategy-kpi-label">Ingreso total</span>
            <span className="strategy-kpi-value">{fmtNumber(resumen.ingreso)}</span>
          </div>
          <div className="strategy-kpi">
            <span className="strategy-kpi-label">Costo total</span>
            <span className="strategy-kpi-value">{fmtNumber(resumen.costo)}</span>
          </div>
          <div className="strategy-kpi">
            <span className="strategy-kpi-label">Margen</span>
            <span className={`strategy-kpi-value ${resumen.margen < 0 ? 'strategy-kpi-value--neg' : 'strategy-kpi-value--pos'}`}>
              {fmtNumber(resumen.margen)}
            </span>
          </div>
          <div className="strategy-kpi">
            <span className="strategy-kpi-label">Margen %</span>
            <span className={`strategy-kpi-value ${resumen.margenPct != null && resumen.margenPct < 0 ? 'strategy-kpi-value--neg' : ''}`}>
              {fmtPct(resumen.margenPct)}
            </span>
          </div>
          <div className="strategy-kpi">
            <span className="strategy-kpi-label">Kg cosechados</span>
            <span className="strategy-kpi-value">{fmtNumber(resumen.kg)}</span>
          </div>
          <div className="strategy-kpi">
            <span className="strategy-kpi-label">Hectáreas</span>
            <span className="strategy-kpi-value">{fmtNumber(resumen.hectareasTotal, 2)}</span>
          </div>
        </div>
      )}

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiList size={14} /></span>
          <h3 className="aur-section-title">Detalle</h3>
          {rows.length > 0 && <span className="aur-section-count">{rows.length}</span>}
        </div>

        {!loading && rows.length === 0 && !error && (
          <p className="strategy-empty">Sin datos para el rango y agrupación seleccionados.</p>
        )}

        {rows.length > 0 && (
          <div className="aur-table-wrap">
            <table className="aur-table">
              <thead>
                <tr>
                  <th>{groupLabel}</th>
                  <th className="aur-td-num">Ha</th>
                  <th className="aur-td-num">Kg</th>
                  <th className="aur-td-num">Kg/ha</th>
                  <th className="aur-td-num">Ingreso</th>
                  <th className="aur-td-num">Costo</th>
                  <th className="aur-td-num">Margen</th>
                  <th className="aur-td-num">Margen/ha</th>
                  <th className="aur-td-num">Margen %</th>
                  <th className="aur-td-num">Días ciclo</th>
                  <th className="aur-td-num">Cosechas</th>
                  <th className="aur-td-num">Aplicac.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key}>
                    <td className="aur-td-strong">{r.label}</td>
                    <td className="aur-td-num">{fmtNumber(r.hectareas, 2)}</td>
                    <td className="aur-td-num">{fmtNumber(r.kg)}</td>
                    <td className="aur-td-num">{r.kgPorHa == null ? '—' : fmtNumber(r.kgPorHa)}</td>
                    <td className="aur-td-num">{fmtNumber(r.ingreso)}</td>
                    <td className="aur-td-num">{fmtNumber(r.costo)}</td>
                    <td className={`aur-td-num ${numNegClass(r.margen)} ${numPosClass(r.margen)}`}>
                      {fmtNumber(r.margen)}
                    </td>
                    <td className={`aur-td-num ${numNegClass(r.margenPorHa)}`}>
                      {r.margenPorHa == null ? '—' : fmtNumber(r.margenPorHa)}
                    </td>
                    <td className={`aur-td-num ${numNegClass(r.margenPct)}`}>
                      {fmtPct(r.margenPct)}
                    </td>
                    <td className="aur-td-num">{fmtDias(r.diasCiclo)}</td>
                    <td className="aur-td-num">{r.nCosechas}</td>
                    <td className="aur-td-num">{r.nAplicaciones}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default YieldHistory;
