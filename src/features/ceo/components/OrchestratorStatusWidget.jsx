import { useEffect, useState, useCallback } from 'react';
import { FiActivity, FiRefreshCw } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useApiFetch } from '../../../hooks/useApiFetch';

// Fase 6.5 — último run del orquestador + urgencias detectadas por dominio.
// Endpoint: GET /api/autopilot/orchestrator/runs (Fase 6.1).

const DOMAIN_LABELS = {
  finance: 'Finanzas',
  procurement: 'Abastecimiento',
  hr: 'RRHH',
  strategy: 'Estrategia',
  financing: 'Financiamiento',
};

const URGENCY_LABELS = {
  none: 'sin urgencia',
  low: 'baja',
  medium: 'media',
  high: 'alta',
  critical: 'urgente',
};

function UrgencyBadge({ urgency }) {
  const key = urgency || 'none';
  return (
    <span className={`ceo-urgency-badge ceo-urgency-badge--${key}`}>{URGENCY_LABELS[key] || key}</span>
  );
}

function OrchestratorStatusWidget() {
  const apiFetch = useApiFetch();
  const [runs, setRuns] = useState([]);
  const [signals, setSignals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/autopilot/orchestrator/runs?limit=5');
      if (!res.ok) throw new Error();
      const rows = await res.json();
      setRuns(Array.isArray(rows) ? rows : []);
      if (rows && rows[0]?.id) {
        const det = await apiFetch(`/api/autopilot/orchestrator/runs/${rows[0].id}`);
        if (det.ok) {
          const full = await det.json();
          setSignals(full.signals || null);
        }
      }
      setError(null);
    } catch {
      setError('No se pudo cargar el plan automático.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const latest = runs[0];

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiActivity size={14} /> Plan automático</span>
        <button type="button" className="btn-icon" onClick={load} disabled={loading} title="Recargar">
          <FiRefreshCw size={12} />
        </button>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && (
        <>
          {!latest ? (
            <div className="fin-widget-empty">
              El Copilot todavía no ha hecho su revisión automática. La hace cada 6 horas.
            </div>
          ) : (
            <>
              <div>
                <div className="fin-widget-primary" style={{ fontSize: '1rem' }}>
                  {latest.status === 'dispatched' ? 'Acciones realizadas' : latest.status === 'partial' ? 'Acciones a medias' : 'Solo recomendación'}
                </div>
                <div className="fin-widget-sub">
                  {latest.topUrgency ? (
                    <>Lo más urgente: <UrgencyBadge urgency={latest.topUrgency} /> · {latest.stepCount} pasos en el plan</>
                  ) : 'Todo bajo control'}
                </div>
                <div className="ceo-score-meta" style={{ marginTop: 4 }}>
                  {latest.createdAt
                    ? new Date(latest.createdAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
                    : ''}
                  {' · '}nivel {latest.effectiveLevel || 'n/a'}
                  {latest.usedClaude ? ' · revisado por IA' : ''}
                </div>
              </div>

              {signals && (
                <div className="ceo-signals">
                  {Object.entries(DOMAIN_LABELS).map(([key, label]) => {
                    const s = signals[key];
                    if (!s) return null;
                    return (
                      <div className="ceo-signal-tile" key={key}>
                        <div className="ceo-signal-tile-domain">{label}</div>
                        <UrgencyBadge urgency={s.urgency} />
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 'auto' }}>
                <Link to="/autopilot" className="btn btn-secondary" style={{ width: '100%', textAlign: 'center' }}>
                  Ver acciones del Copilot
                </Link>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default OrchestratorStatusWidget;
