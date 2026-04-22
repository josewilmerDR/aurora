import { useEffect, useState } from 'react';
import { FiUserPlus } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

// Lists autopilot_actions with type=sugerir_contratacion and status=proposed.
// Supervisor-only. NEVER shows a "execute" button — hiring is arch-capped to
// proposed state (phase 3.0/3.4).
function HiringRecommendationsCard() {
  const apiFetch = useApiFetch();
  const [actions, setActions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/api/autopilot/actions?categoria=hr&status=proposed')
      .then(r => r.json())
      .then(all => {
        const hiring = (all || []).filter(a => a.type === 'sugerir_contratacion');
        setActions(hiring);
      })
      .catch(() => setError('No se pudieron cargar las recomendaciones.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const urgencyClass = (prioridad) =>
    prioridad === 'alta' ? 'hr-tag--danger' : prioridad === 'media' ? 'hr-tag--warn' : 'hr-tag--neutral';

  return (
    <div className="hr-widget">
      <div className="hr-widget-header">
        <span className="hr-widget-title"><FiUserPlus size={14} /> Recomendaciones de contratación</span>
        <span className="hr-widget-sub">solo propuestas</span>
      </div>

      {loading && <div className="hr-widget-loading">Cargando…</div>}
      {error && <div className="hr-widget-loading hr-widget-error">{error}</div>}
      {!loading && !error && actions && actions.length === 0 && (
        <div className="hr-widget-empty">Sin recomendaciones pendientes.</div>
      )}

      {!loading && !error && actions && actions.length > 0 && (
        <div className="hr-rec-list">
          {actions.map(a => {
            const rec = a.hrRecommendation || {};
            return (
              <div key={a.id} className="hr-rec-item">
                <div className="hr-rec-item-head">
                  <span className={`hr-tag ${urgencyClass(a.prioridad)}`}>{a.prioridad}</span>
                  <span className="hr-rec-item-title">{a.titulo}</span>
                </div>
                <p className="hr-rec-item-desc">{a.descripcion}</p>
                {rec.weekStart && (
                  <p className="hr-widget-sub">
                    Semana: {rec.weekStart} → {rec.weekEnd || rec.weekStart} · {rec.consecutiveWeeks} sem. consecutivas
                    {' · '}
                    <strong>{rec.recommendedAction}</strong>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default HiringRecommendationsCard;
