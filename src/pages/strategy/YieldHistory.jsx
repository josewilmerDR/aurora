import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiBarChart2, FiRefreshCw } from 'react-icons/fi';
import { useApiFetch } from '../../hooks/useApiFetch';
import './strategy.css';

// ─── Formateos ─────────────────────────────────────────────────────────────
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

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiBarChart2 /> Rendimiento Histórico</h2>
      </div>

      <p className="strategy-empty" style={{ padding: 0, textAlign: 'left', marginBottom: 14 }}>
        Rendimiento físico y económico agregado por distintas dimensiones. Los costos e ingresos reutilizan la
        misma atribución que el ROI en vivo.
      </p>

      <div className="strategy-filters">
        <div className="strategy-field">
          <label>Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div className="strategy-field">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
        <div className="strategy-field">
          <label>Agrupar por</label>
          <div className="strategy-segmented">
            {GROUP_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={groupBy === opt.value ? 'active' : ''}
                onClick={() => setGroupBy(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <button className="primary-button" onClick={load} disabled={loading}>
          <FiRefreshCw /> {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {error && <div className="strategy-empty" style={{ color: '#ff8080' }}>{error}</div>}

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

      {!loading && rows.length === 0 && !error && (
        <div className="strategy-empty">Sin datos para el rango y agrupación seleccionados.</div>
      )}

      {rows.length > 0 && (
        <div className="strategy-table-wrap">
          <table className="strategy-table">
            <thead>
              <tr>
                <th>{GROUP_OPTIONS.find(o => o.value === groupBy)?.label?.replace('Por ', '') || ''}</th>
                <th>Ha</th>
                <th>Kg</th>
                <th>Kg/ha</th>
                <th>Ingreso</th>
                <th>Costo</th>
                <th>Margen</th>
                <th>Margen/ha</th>
                <th>Margen %</th>
                <th>Días ciclo</th>
                <th>Cosechas</th>
                <th>Aplicac.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td>{fmtNumber(r.hectareas, 2)}</td>
                  <td>{fmtNumber(r.kg)}</td>
                  <td>{r.kgPorHa == null ? '—' : fmtNumber(r.kgPorHa)}</td>
                  <td>{fmtNumber(r.ingreso)}</td>
                  <td>{fmtNumber(r.costo)}</td>
                  <td className={`strategy-amount ${r.margen < 0 ? 'strategy-amount--neg' : ''}`}>
                    {fmtNumber(r.margen)}
                  </td>
                  <td className={`strategy-amount ${r.margenPorHa != null && r.margenPorHa < 0 ? 'strategy-amount--neg' : ''}`}>
                    {r.margenPorHa == null ? '—' : fmtNumber(r.margenPorHa)}
                  </td>
                  <td className={`strategy-amount ${r.margenPct != null && r.margenPct < 0 ? 'strategy-amount--neg' : ''}`}>
                    {fmtPct(r.margenPct)}
                  </td>
                  <td>{fmtDias(r.diasCiclo)}</td>
                  <td>{r.nCosechas}</td>
                  <td>{r.nAplicaciones}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default YieldHistory;
