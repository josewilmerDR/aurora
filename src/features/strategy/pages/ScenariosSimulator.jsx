import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiGitBranch, FiCpu, FiRefreshCw, FiEye, FiX, FiSliders, FiList,
  FiBarChart2, FiActivity,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/strategy.css';

// Paletas por escenario para consistencia visual. Pesimista usa amber
// (--aur-warn) en lugar de un rojo arbitrario; Base preserva magenta como
// línea baseline brand-specific; Optimista usa verde Aurora.
const SCENARIO_STYLE = {
  Pesimista: { color: 'var(--aur-warn)',       badge: 'aur-badge--yellow' },
  Base:      { color: 'var(--aurora-magenta)', badge: 'aur-badge--violet' },
  Optimista: { color: 'var(--aur-accent)',     badge: 'aur-badge--green' },
};

function fmtN(n) {
  if (!Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtPct(n) {
  if (!Number.isFinite(Number(n))) return '—';
  return `${Math.round(Number(n) * 100)}%`;
}
function fmtTs(ts) {
  if (!ts) return '—';
  if (ts._seconds != null) return new Date(ts._seconds * 1000).toLocaleString();
  return '—';
}

// Mini-gráfico SVG de la proyección de caja mensual. Mantiene el patrón
// "sin Chart.js" del resto de la app.
function CashSparkline({ series, horizonteMeses }) {
  if (!Array.isArray(series) || series.length === 0) return null;
  const rows = series.filter(s => Array.isArray(s.data) && s.data.length > 0);
  if (rows.length === 0) return null;
  const width = 520, height = 140, pad = 24;
  const allValues = rows.flatMap(r => r.data);
  const min = Math.min(...allValues, 0);
  const max = Math.max(...allValues, 1);
  const span = max - min || 1;
  const xStep = (width - 2 * pad) / Math.max(1, horizonteMeses - 1);
  const y = v => height - pad - ((v - min) / span) * (height - 2 * pad);

  return (
    <svg className="strategy-sparkline" width="100%" viewBox={`0 0 ${width} ${height}`}>
      {min < 0 && max > 0 && (
        <line
          x1={pad} x2={width - pad}
          y1={y(0)} y2={y(0)}
          stroke="var(--aur-divider-2)"
          strokeDasharray="3 3"
        />
      )}
      {rows.map((row, rIdx) => {
        const pts = row.data.map((v, i) => `${pad + i * xStep},${y(v)}`).join(' ');
        return (
          <polyline
            key={rIdx}
            fill="none"
            stroke={row.color}
            strokeWidth={row.highlight ? 3 : 2}
            opacity={row.highlight ? 1 : 0.7}
            points={pts}
          />
        );
      })}
    </svg>
  );
}

function ScenariosSimulator() {
  const apiFetch = useApiFetch();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState(null);
  const [toast, setToast] = useState(null);

  const [name, setName] = useState('');
  const [horizonteMeses, setHorizonteMeses] = useState(12);
  const [nTrials, setNTrials] = useState(500);
  const [seed, setSeed] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/strategy/scenarios')
      .then(r => r.json())
      .then(data => setRuns(Array.isArray(data) ? data : []))
      .catch(() => setToast({ type: 'error', message: 'No se pudieron cargar las corridas.' }))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const runSimulate = async () => {
    setRunning(true);
    try {
      const body = {
        name: name.trim() || undefined,
        horizonteMeses: Number(horizonteMeses) || 12,
        nTrials: Number(nTrials) || 500,
      };
      const parsedSeed = Number(seed);
      if (seed !== '' && Number.isFinite(parsedSeed)) body.seed = parsedSeed;
      const res = await apiFetch('/api/strategy/scenarios/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'simulate failed');
      setToast({ type: 'success', message: 'Simulación completada.' });
      setName('');
      load();
      setDetail(data);
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo simular.' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="aur-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title"><FiGitBranch /> Escenarios What-if</h2>
          <p className="aur-sheet-subtitle">
            Genera 3 escenarios anuales (Pesimista / Base / Optimista) con Monte Carlo sobre el rendimiento
            histórico, la tesorería actual y los compromisos conocidos. Claude sintetiza trade-offs y sugiere
            prioridad.
          </p>
        </div>
        <div className="aur-sheet-header-actions">
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={load}
            disabled={loading}
          >
            <FiRefreshCw size={14} /> Refrescar
          </button>
        </div>
      </header>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiSliders size={14} /></span>
          <h3 className="aur-section-title">Nueva simulación</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="ss-name">Nombre</label>
            <div className="aur-field">
              <input
                id="ss-name"
                type="text"
                className="aur-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Plan 2026-Q1"
              />
              <p className="aur-field-hint">Opcional. Se autogenera si lo dejas vacío.</p>
            </div>
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="ss-horizonte">Horizonte (meses)</label>
            <div className="aur-field">
              <input
                id="ss-horizonte"
                type="number"
                min={1}
                max={24}
                className="aur-input aur-input--num"
                value={horizonteMeses}
                onChange={e => setHorizonteMeses(e.target.value)}
              />
            </div>
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="ss-trials">Nº de trials</label>
            <div className="aur-field">
              <input
                id="ss-trials"
                type="number"
                min={10}
                max={5000}
                className="aur-input aur-input--num"
                value={nTrials}
                onChange={e => setNTrials(e.target.value)}
              />
            </div>
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="ss-seed">Semilla</label>
            <div className="aur-field">
              <input
                id="ss-seed"
                type="number"
                className="aur-input aur-input--num"
                value={seed}
                onChange={e => setSeed(e.target.value)}
                placeholder="aleatoria"
              />
              <p className="aur-field-hint">Opcional. Reproducibilidad para auditoría.</p>
            </div>
          </div>
        </div>
        <div className="aur-form-actions">
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={runSimulate}
            disabled={running}
          >
            <FiCpu size={14} /> {running ? 'Simulando…' : 'Simular'}
          </button>
        </div>
      </section>

      {detail && <ScenarioDetail detail={detail} onClose={() => setDetail(null)} />}

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiList size={14} /></span>
          <h3 className="aur-section-title">Corridas previas</h3>
          {runs.length > 0 && <span className="aur-section-count">{runs.length}</span>}
        </div>

        {loading ? (
          <p className="strategy-empty">Cargando…</p>
        ) : runs.length === 0 ? (
          <p className="strategy-empty">Todavía no has corrido ninguna simulación.</p>
        ) : (
          <div className="aur-list">
            {runs.map(r => (
              <div key={r.id} className="aur-row strategy-item-row">
                <div className="strategy-item-info">
                  <div className="strategy-item-head">
                    <span className="strategy-item-title">{r.name}</span>
                    <span className="aur-badge aur-badge--violet">{r.nTrials} trials</span>
                    <span className="aur-badge aur-badge--blue">{r.horizonteMeses}m</span>
                  </div>
                  <div className="strategy-item-sub">
                    {fmtTs(r.createdAt)} · seed {r.seed} · margen mediano {fmtN(r.resumen?.margenMedio)}
                  </div>
                  {r.claudeAnalysis?.recomendacion?.escenarioPreferido && (
                    <div className="strategy-item-meta">
                      Claude recomienda: <strong>{r.claudeAnalysis.recomendacion.escenarioPreferido}</strong>
                    </div>
                  )}
                  {r.warnings?.length > 0 && (
                    <div className="strategy-item-meta strategy-num--warn">
                      {r.warnings.length} warning(s) — ver detalle
                    </div>
                  )}
                </div>
                <div className="strategy-item-actions">
                  <button
                    type="button"
                    className="aur-btn-pill aur-btn-pill--sm"
                    onClick={() => setDetail(r)}
                  >
                    <FiEye size={14} /> Ver
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function ScenarioDetail({ detail, onClose }) {
  const scenarios = detail.scenarios || [];
  const horizonteMeses = detail.horizonteMeses || detail.context?.horizonteMeses || 12;
  const sparkSeries = useMemo(() => ([
    ...scenarios.map(s => ({
      name: s.name,
      data: Array.isArray(s.proyeccionCaja) ? s.proyeccionCaja : [],
      color: SCENARIO_STYLE[s.name]?.color || 'var(--aurora-magenta)',
      highlight: true,
    })),
    ...(detail.trialsAggregate?.cashByMonthMedian
      ? [{ name: 'Mediana global', data: detail.trialsAggregate.cashByMonthMedian, color: 'var(--aur-text)', highlight: false }]
      : []
    ),
  ]), [detail, scenarios]);

  return (
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiBarChart2 size={14} /></span>
        <h3 className="aur-section-title">{detail.name || 'Simulación'}</h3>
        <div className="aur-section-actions">
          <span className="strategy-meta-text">
            {detail.nTrials} trials · seed {detail.seed}
          </span>
          <button
            type="button"
            className="aur-icon-btn aur-icon-btn--sm"
            onClick={onClose}
            title="Cerrar"
          >
            <FiX size={14} />
          </button>
        </div>
      </div>

      {detail.warnings?.length > 0 && (
        <div className="aur-banner aur-banner--warn">
          <FiActivity size={14} />
          <div>Warnings: {detail.warnings.join(' · ')}</div>
        </div>
      )}

      <div className="strategy-kpis">
        <div className="strategy-kpi">
          <span className="strategy-kpi-label">Ingreso mediano</span>
          <span className="strategy-kpi-value">{fmtN(detail.resumen?.ingresoMedio)}</span>
        </div>
        <div className="strategy-kpi">
          <span className="strategy-kpi-label">Costo mediano</span>
          <span className="strategy-kpi-value">{fmtN(detail.resumen?.costoMedio)}</span>
        </div>
        <div className="strategy-kpi">
          <span className="strategy-kpi-label">Margen mediano</span>
          <span className={`strategy-kpi-value ${detail.resumen?.margenMedio < 0 ? 'strategy-kpi-value--neg' : 'strategy-kpi-value--pos'}`}>
            {fmtN(detail.resumen?.margenMedio)}
          </span>
        </div>
        <div className="strategy-kpi">
          <span className="strategy-kpi-label">Caja final mediana</span>
          <span className={`strategy-kpi-value ${detail.resumen?.cajaFinalMedia < 0 ? 'strategy-kpi-value--neg' : ''}`}>
            {fmtN(detail.resumen?.cajaFinalMedia)}
          </span>
        </div>
      </div>

      <div className="strategy-chart">
        <div className="strategy-chart-title">Proyección de caja (mediana mensual por escenario)</div>
        <CashSparkline series={sparkSeries} horizonteMeses={horizonteMeses} />
        <div className="strategy-chart-legend">
          {sparkSeries.map(s => (
            <span key={s.name} className="strategy-chart-legend-item">
              <span className="strategy-chart-swatch" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      </div>

      <div className="strategy-proposals">
        {scenarios.map(s => (
          <div key={s.name} className="strategy-proposal">
            <div className="strategy-item-head">
              <span className="strategy-item-title">{s.name}</span>
              <span className={`aur-badge ${SCENARIO_STYLE[s.name]?.badge || 'aur-badge--gray'}`}>
                Prob. {fmtPct(s.probabilidad)}
              </span>
            </div>
            <div className="strategy-item-sub">
              Ingreso {fmtN(s.ingresoProyectado)} · Costo {fmtN(s.costoProyectado)} · Margen {fmtN(s.margenProyectado)}
            </div>
            <div className="strategy-item-meta">
              Caja final p10/p50/p90: {fmtN(s.percentiles?.cajaFinal?.p10)} / {fmtN(s.percentiles?.cajaFinal?.p50)} / {fmtN(s.percentiles?.cajaFinal?.p90)}
            </div>
            {s.riesgos?.length > 0 && (
              <div className="strategy-item-meta strategy-num--neg">
                Riesgos: {s.riesgos.join(' · ')}
              </div>
            )}
            {s.supuestos?.length > 0 && (
              <details className="strategy-reasoning strategy-reasoning--inline">
                <summary>Supuestos</summary>
                <ul className="strategy-reasoning-list">
                  {s.supuestos.map((sup, i) => <li key={i}>{sup}</li>)}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>

      {detail.claudeAnalysis && !detail.claudeAnalysis.error && (
        <div className="strategy-analysis">
          <div className="strategy-analysis-label">Análisis estratégico (Claude)</div>
          <div className="strategy-analysis-body">{detail.claudeAnalysis.comentario}</div>
          {detail.claudeAnalysis.recomendacion && (
            <div className="strategy-analysis-reco">
              <strong>Recomendación:</strong> {detail.claudeAnalysis.recomendacion.escenarioPreferido}
              <div className="strategy-item-meta">
                {detail.claudeAnalysis.recomendacion.razon}
              </div>
              {detail.claudeAnalysis.recomendacion.accionesSugeridas?.length > 0 && (
                <ul className="strategy-reasoning-list">
                  {detail.claudeAnalysis.recomendacion.accionesSugeridas.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              )}
            </div>
          )}
          {detail.claudeAnalysis.tradeOffs?.length > 0 && (
            <details className="strategy-reasoning strategy-reasoning--inline">
              <summary>Trade-offs</summary>
              <ul className="strategy-reasoning-list">
                {detail.claudeAnalysis.tradeOffs.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {detail.reasoning?.thinking && (
        <details className="strategy-reasoning">
          <summary>Razonamiento del modelo</summary>
          <pre className="strategy-reasoning-pre">{detail.reasoning.thinking}</pre>
        </details>
      )}
    </section>
  );
}

export default ScenariosSimulator;
