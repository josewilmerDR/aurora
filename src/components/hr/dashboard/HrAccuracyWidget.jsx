import { useEffect, useState } from 'react';
import { FiTarget } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

// Tracks the phase-3 exit-criterion KPI: of HR recommendations the
// admin judged retrospectively, what fraction matched reality. Rows
// without outcomeMatchedReality (still pending) are counted separately.
function HrAccuracyWidget() {
  const apiFetch = useApiFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/api/hr/recommendations-accuracy?months=6')
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('No se pudo cargar la métrica.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const hitRate = data?.overall?.hitRate;
  const decided = data?.overall?.decidedCount ?? 0;
  const pending = data?.overall?.pending ?? 0;
  const goalReached = hitRate != null && hitRate >= 0.9;

  return (
    <div className="hr-widget">
      <div className="hr-widget-header">
        <span className="hr-widget-title"><FiTarget size={14} /> Acierto vs decisiones humanas</span>
        <span className="hr-widget-sub">últimos 6 meses</span>
      </div>

      {loading && <div className="hr-widget-loading">Cargando…</div>}
      {error && <div className="hr-widget-loading hr-widget-error">{error}</div>}
      {!loading && !error && data && (
        <>
          <div>
            <div
              className="hr-self-score"
              style={{ color: goalReached ? 'var(--aurora-green)' : '#ffcc33' }}
            >
              {hitRate == null ? '—' : `${Math.round(hitRate * 100)}%`}
            </div>
            <div className="hr-widget-sub">
              {decided === 0
                ? 'Aún sin suficientes veredictos del administrador para calcular.'
                : `${decided} recomendación(es) con veredicto. ${pending} pendientes.`}
            </div>
          </div>

          {data.byType && Object.keys(data.byType).length > 0 && (
            <div className="hr-prod-rows" style={{ fontSize: '0.8rem' }}>
              {Object.entries(data.byType).map(([type, agg]) => (
                <div key={type} className="hr-prod-row hr-prod-row--in_range">
                  <span className="hr-prod-user">{type}</span>
                  <span className="hr-prod-lote">
                    {agg.hitRate == null ? '—' : `${Math.round(agg.hitRate * 100)}%`}
                  </span>
                  <span className="hr-prod-avg">{agg.decidedCount}</span>
                  <span className="hr-widget-sub">pend: {agg.pending}</span>
                </div>
              ))}
            </div>
          )}

          <div className="hr-widget-sub">
            Criterio de salida de Fase 3: ≥ 90% en ventana de 6 meses.
          </div>
        </>
      )}
    </div>
  );
}

export default HrAccuracyWidget;
