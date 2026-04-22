import { useEffect, useState } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../../contexts/UserContext';

// Lists performance review alerts. Reasoning (Claude thinking) is
// visible only when the viewer is supervisor+ — enforced twice: once
// server-side via includeReasoning role gate, and once here before
// displaying so we never fetch it needlessly.
function PerformanceAlertsCard() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const canSeeReasoning = hasMinRole(currentUser?.rol, 'supervisor');

  const [actions, setActions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const url = canSeeReasoning
      ? '/api/autopilot/actions?categoria=hr&status=proposed&includeReasoning=1'
      : '/api/autopilot/actions?categoria=hr&status=proposed';
    apiFetch(url)
      .then(r => r.json())
      .then(all => {
        const alerts = (all || []).filter(a => a.type === 'sugerir_revision_desempeno');
        setActions(alerts);
      })
      .catch(() => setError('No se pudieron cargar las alertas.'))
      .finally(() => setLoading(false));
  }, [apiFetch, canSeeReasoning]);

  const severityClass = (sev) =>
    sev === 'alta' ? 'hr-tag--danger' : sev === 'media' ? 'hr-tag--warn' : 'hr-tag--neutral';

  return (
    <div className="hr-widget">
      <div className="hr-widget-header">
        <span className="hr-widget-title"><FiAlertTriangle size={14} /> Alertas de desempeño</span>
        <span className="hr-widget-sub">sugerencias de conversación</span>
      </div>

      {loading && <div className="hr-widget-loading">Cargando…</div>}
      {error && <div className="hr-widget-loading hr-widget-error">{error}</div>}
      {!loading && !error && actions && actions.length === 0 && (
        <div className="hr-widget-empty">Sin alertas abiertas.</div>
      )}

      {!loading && !error && actions && actions.length > 0 && (
        <div className="hr-rec-list">
          {actions.map(a => {
            const severity = a.params?.severity || 'media';
            const hasThinking = canSeeReasoning && a.reasoning?.thinking;
            return (
              <div key={a.id} className="hr-rec-item">
                <div className="hr-rec-item-head">
                  <span className={`hr-tag ${severityClass(severity)}`}>{severity}</span>
                  <span className="hr-rec-item-title">{a.titulo}</span>
                </div>
                <p className="hr-rec-item-desc">{a.descripcion}</p>
                {hasThinking && (
                  <details className="hr-reasoning-details">
                    <summary>Razonamiento del modelo</summary>
                    <pre>{a.reasoning.thinking}</pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PerformanceAlertsCard;
