import { useEffect, useState, useCallback } from 'react';
import { FiCheckCircle, FiRefreshCw } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

// Fase 6.5 — hit-rate de observaciones KPI. Endpoint: GET /api/meta/kpi-accuracy.

const ACTION_TYPE_LABELS = {
  reasignar_presupuesto:      'Reasignar presupuesto',
  crear_orden_compra:         'Orden de compra',
  crear_solicitud_compra:     'Solicitud de compra',
  crear_siembra:              'Crear siembra',
  crear_tarea:                'Crear tarea',
  sugerir_contratacion:       'Sugerir contratación',
  sugerir_despido:            'Sugerir despido',
  sugerir_sancion:            'Sugerir sanción',
  sugerir_memorando:          'Sugerir memorando',
  sugerir_revision_desempeno: 'Revisión de desempeño',
  orchestrator_run:           'Plan automático del Copilot',
  ajustar_guardrails:         'Ajustar reglas',
};

function fmtHitRate(v) {
  if (v == null) return '—';
  const pct = Math.round(v * 1000) / 10;
  return `${pct.toFixed(1)}%`;
}

function hitRateClass(v) {
  if (v == null) return '';
  if (v >= 0.85) return 'fin-badge fin-badge--ok';
  if (v >= 0.6) return 'fin-badge fin-badge--warn';
  return 'fin-badge fin-badge--bad';
}

function KpiAccuracyWidget() {
  const apiFetch = useApiFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [window, setWindow] = useState('30');

  const load = useCallback(() => {
    setLoading(true);
    const qs = window ? `?window=${window}` : '';
    apiFetch(`/api/meta/kpi-accuracy${qs}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('No se pudieron cargar los aciertos.'))
      .finally(() => setLoading(false));
  }, [apiFetch, window]);

  useEffect(() => { load(); }, [load]);

  const byActionType = data?.byActionType || {};
  const rows = Object.entries(byActionType)
    .map(([type, agg]) => ({ type, ...agg }))
    .sort((a, b) => (b.total || 0) - (a.total || 0));

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiCheckCircle size={14} /> Aciertos del Copilot</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            value={window}
            onChange={e => setWindow(e.target.value)}
            style={{ fontSize: '0.75rem', padding: '2px 6px', background: 'transparent', color: 'var(--aurora-light)', border: '1px solid var(--aurora-border)', borderRadius: 4 }}
          >
            <option value="30">30 días</option>
            <option value="90">90 días</option>
            <option value="365">1 año</option>
          </select>
          <button type="button" className="btn-icon" onClick={load} disabled={loading} title="Recargar">
            <FiRefreshCw size={12} />
          </button>
        </div>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && data && (
        <>
          <div>
            <div className="fin-widget-primary" style={{ fontSize: '1.4rem' }}>
              {fmtHitRate(data.overall?.hitRate)}
            </div>
            <div className="fin-widget-sub">
              Aciertos en general · {data.overall?.decidedCount || 0} decisiones evaluadas
              {data.observationCount > 0
                ? ` · basado en ${data.observationCount} registros${data.truncated ? ' (limitado)' : ''}`
                : ''}
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="fin-widget-empty">
              Todavía no hay datos para evaluar. El Copilot revisa los resultados cada día.
            </div>
          ) : (
            <div style={{ overflowY: 'auto', maxHeight: 180 }}>
              {rows.map(r => (
                <div className="ceo-kpi-row" key={r.type}>
                  <span className="ceo-kpi-type">
                    {ACTION_TYPE_LABELS[r.type] || r.type}
                  </span>
                  <span className="ceo-kpi-count">
                    {r.match} aciertos de {r.decidedCount} · {r.pending} por evaluar
                  </span>
                  <span className={`ceo-kpi-rate ${hitRateClass(r.hitRate)}`}>
                    {fmtHitRate(r.hitRate)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default KpiAccuracyWidget;
