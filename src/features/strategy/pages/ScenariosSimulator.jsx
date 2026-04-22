import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiGitBranch, FiCpu, FiRefreshCw, FiEye, FiX } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/strategy.css';

// Paletas por escenario para consistencia visual.
const SCENARIO_STYLE = {
  Pesimista: { color: '#ff8080', badge: 'temporada-badge--archived' },
  Base: { color: 'var(--aurora-magenta)', badge: 'temporada-badge--auto' },
  Optimista: { color: 'var(--aurora-green)', badge: 'temporada-badge--manual' },
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
function CashSparkline({ series, horizonteMeses, highlightIdx = -1 }) {
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
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {/* Eje cero */}
      {min < 0 && max > 0 && (
        <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke="var(--aurora-border)" strokeDasharray="3 3" />
      )}
      {/* Series */}
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

  // Parámetros de la corrida.
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
    <div className="page-container">
      <div className="page-header">
        <h2><FiGitBranch /> Escenarios What-if</h2>
      </div>

      <p className="strategy-empty" style={{ padding: 0, textAlign: 'left', marginBottom: 14 }}>
        Genera 3 escenarios anuales (Pesimista / Base / Optimista) con Monte Carlo sobre el rendimiento histórico,
        la tesorería actual y los compromisos conocidos. Claude sintetiza trade-offs y sugiere prioridad.
      </p>

      {/* ── Generador ─────────────────────────────────────────────── */}
      <div className="strategy-filters">
        <div className="strategy-field" style={{ minWidth: 220 }}>
          <label>Nombre (opcional)</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Plan 2026-Q1" />
        </div>
        <div className="strategy-field">
          <label>Horizonte (meses)</label>
          <input type="number" min={1} max={24} value={horizonteMeses} onChange={e => setHorizonteMeses(e.target.value)} />
        </div>
        <div className="strategy-field">
          <label>Nº de trials</label>
          <input type="number" min={10} max={5000} value={nTrials} onChange={e => setNTrials(e.target.value)} />
        </div>
        <div className="strategy-field">
          <label>Semilla (opcional)</label>
          <input type="number" value={seed} onChange={e => setSeed(e.target.value)} placeholder="aleatoria" />
        </div>
        <button className="primary-button" onClick={runSimulate} disabled={running}>
          <FiCpu /> {running ? 'Simulando…' : 'Simular'}
        </button>
        <button className="primary-button" onClick={load} disabled={loading}>
          <FiRefreshCw /> Refrescar
        </button>
      </div>

      {/* ── Detalle seleccionado ─────────────────────────────────── */}
      {detail && <ScenarioDetail detail={detail} onClose={() => setDetail(null)} />}

      {/* ── Historial ────────────────────────────────────────────── */}
      <h3 style={{ margin: '18px 0 10px', fontSize: 14, opacity: 0.75 }}>
        Corridas previas ({runs.length})
      </h3>
      {loading ? (
        <div className="strategy-empty">Cargando…</div>
      ) : runs.length === 0 ? (
        <div className="strategy-empty">Todavía no has corrido ninguna simulación.</div>
      ) : (
        <div className="temporadas-list">
          {runs.map(r => (
            <div key={r.id} className="temporada-card">
              <div>
                <div className="temporada-card-header">
                  <span className="temporada-name">{r.name}</span>
                  <span className="temporada-badge temporada-badge--auto">{r.nTrials} trials</span>
                  <span className="temporada-badge temporada-badge--manual">{r.horizonteMeses}m</span>
                </div>
                <div className="temporada-range">
                  {fmtTs(r.createdAt)} · seed {r.seed} · margen mediano {fmtN(r.resumen?.margenMedio)}
                </div>
                {r.claudeAnalysis?.recomendacion?.escenarioPreferido && (
                  <div className="temporada-meta">
                    Claude recomienda: <strong>{r.claudeAnalysis.recomendacion.escenarioPreferido}</strong>
                  </div>
                )}
                {r.warnings?.length > 0 && (
                  <div className="temporada-meta" style={{ color: '#e0b000' }}>
                    {r.warnings.length} warning(s) — ver detalle
                  </div>
                )}
              </div>
              <div className="temporada-actions">
                <button className="primary-button" onClick={() => setDetail(r)}>
                  <FiEye /> Ver
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
      ? [{ name: 'Mediana global', data: detail.trialsAggregate.cashByMonthMedian, color: 'var(--aurora-light)', highlight: false }]
      : []
    ),
  ]), [detail, scenarios]);

  return (
    <div className="temporada-card" style={{ gridTemplateColumns: '1fr', marginBottom: 18 }}>
      <div>
        <div className="temporada-card-header" style={{ justifyContent: 'space-between' }}>
          <div>
            <span className="temporada-name">{detail.name || 'Simulación'}</span>
            <span className="temporada-meta" style={{ marginLeft: 10 }}>
              {detail.nTrials} trials · seed {detail.seed}
            </span>
          </div>
          <button className="primary-button" onClick={onClose}>
            <FiX /> Cerrar
          </button>
        </div>

        {detail.warnings?.length > 0 && (
          <div className="temporada-meta" style={{ marginTop: 8, color: '#e0b000' }}>
            Warnings: {detail.warnings.join(' · ')}
          </div>
        )}

        {/* KPIs globales */}
        <div className="strategy-kpis" style={{ marginTop: 12 }}>
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

        {/* Chart */}
        <div style={{ marginTop: 12, background: 'var(--aurora-dark-blue)', border: '1px solid var(--aurora-border)', borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
            Proyección de caja (mediana mensual por escenario)
          </div>
          <CashSparkline series={sparkSeries} horizonteMeses={horizonteMeses} />
          <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11, flexWrap: 'wrap' }}>
            {sparkSeries.map(s => (
              <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ display: 'inline-block', width: 12, height: 3, background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        </div>

        {/* Escenarios */}
        <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          {scenarios.map(s => (
            <div key={s.name} className="temporada-proposal" style={{ gridTemplateColumns: '1fr' }}>
              <div>
                <div className="temporada-card-header">
                  <span className="temporada-name" style={{ color: SCENARIO_STYLE[s.name]?.color }}>{s.name}</span>
                  <span className={`temporada-badge ${SCENARIO_STYLE[s.name]?.badge || ''}`}>
                    Prob. {fmtPct(s.probabilidad)}
                  </span>
                </div>
                <div className="temporada-range">
                  Ingreso {fmtN(s.ingresoProyectado)} · Costo {fmtN(s.costoProyectado)} · Margen {fmtN(s.margenProyectado)}
                </div>
                <div className="temporada-meta">
                  Caja final p10/p50/p90: {fmtN(s.percentiles?.cajaFinal?.p10)} / {fmtN(s.percentiles?.cajaFinal?.p50)} / {fmtN(s.percentiles?.cajaFinal?.p90)}
                </div>
                {s.riesgos?.length > 0 && (
                  <div className="temporada-meta" style={{ marginTop: 4, color: '#ff8080' }}>
                    Riesgos: {s.riesgos.join(' · ')}
                  </div>
                )}
                {s.supuestos?.length > 0 && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, opacity: 0.6 }}>Supuestos</summary>
                    <ul style={{ marginTop: 6, fontSize: 12 }}>
                      {s.supuestos.map((sup, i) => <li key={i}>{sup}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Análisis de Claude */}
        {detail.claudeAnalysis && !detail.claudeAnalysis.error && (
          <div style={{ marginTop: 14, padding: 12, background: 'var(--aurora-dark-blue)', border: '1px solid var(--aurora-border)', borderRadius: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Análisis estratégico (Claude)</div>
            <div>{detail.claudeAnalysis.comentario}</div>
            {detail.claudeAnalysis.recomendacion && (
              <div style={{ marginTop: 8 }}>
                <strong>Recomendación:</strong> {detail.claudeAnalysis.recomendacion.escenarioPreferido}
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                  {detail.claudeAnalysis.recomendacion.razon}
                </div>
                {detail.claudeAnalysis.recomendacion.accionesSugeridas?.length > 0 && (
                  <ul style={{ fontSize: 12, marginTop: 6 }}>
                    {detail.claudeAnalysis.recomendacion.accionesSugeridas.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                )}
              </div>
            )}
            {detail.claudeAnalysis.tradeOffs?.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>Trade-offs</summary>
                <ul style={{ fontSize: 12, marginTop: 6 }}>
                  {detail.claudeAnalysis.tradeOffs.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        {detail.reasoning?.thinking && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>Razonamiento del modelo</summary>
            <pre style={{
              whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 6,
              padding: 10, background: 'var(--aurora-dark-blue)',
              border: '1px solid var(--aurora-border)', borderRadius: 6,
            }}>{detail.reasoning.thinking}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

export default ScenariosSimulator;
