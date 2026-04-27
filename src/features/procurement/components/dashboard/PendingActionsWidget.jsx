import { useCallback, useEffect, useState } from 'react';
import { FiClock, FiCheck, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

const PRIORITY_BADGE_VARIANT = {
  alta:  'aur-badge--magenta',
  media: 'aur-badge--yellow',
  baja:  'aur-badge--blue',
};

function PriorityPill({ prioridad }) {
  const variant = PRIORITY_BADGE_VARIANT[prioridad] || PRIORITY_BADGE_VARIANT.media;
  return (
    <span className={`aur-badge ${variant}`}>{prioridad || 'media'}</span>
  );
}

function PendingActionsWidget() {
  const apiFetch = useApiFetch();
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/autopilot/actions?categoria=procurement&status=proposed')
      .then(r => r.json())
      .then(data => setActions(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudieron cargar las acciones.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const handle = async (actionId, verb) => {
    setBusy(actionId);
    try {
      const r = await apiFetch(`/api/autopilot/actions/${actionId}/${verb}`, { method: 'PUT' });
      if (!r.ok) throw new Error(await r.text());
      setActions(prev => prev.filter(a => a.id !== actionId));
    } catch {
      setError('La operación falló; refresca y reintenta.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiClock size={14} /></span>
        <h3 className="aur-section-title">Aprobaciones abastecimiento</h3>
        <span className="aur-section-count">{actions.length}</span>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && (
        actions.length === 0 ? (
          <div className="fin-widget-empty">Sin acciones pendientes.</div>
        ) : (
          <div className="fin-budget-rows">
            {actions.slice(0, 5).map(a => {
              const estimated = a.estimatedAmount;
              return (
                <div key={a.id} className="fin-budget-row">
                  <div className="fin-budget-row-head">
                    <span className="fin-budget-row-cat" title={a.descripcion || ''}>
                      {a.titulo || a.type}
                    </span>
                    <PriorityPill prioridad={a.prioridad} />
                  </div>
                  <span className="fin-widget-sub">
                    {a.type === 'crear_orden_compra' ? 'OC' : 'Solicitud'}
                    {estimated ? ` · ~$${Number(estimated).toFixed(0)}` : ''}
                    {a.procurementSupplier?.name ? ` · ${a.procurementSupplier.name}` : ''}
                  </span>
                  <div className="proc-pending-actions">
                    <button
                      type="button"
                      className="aur-btn-pill aur-btn-pill--sm"
                      onClick={() => handle(a.id, 'approve')}
                      disabled={busy === a.id}
                    >
                      <FiCheck size={12} /> Aprobar
                    </button>
                    <button
                      type="button"
                      className="aur-btn-pill aur-btn-pill--sm aur-btn-pill--danger"
                      onClick={() => handle(a.id, 'reject')}
                      disabled={busy === a.id}
                    >
                      <FiX size={12} /> Rechazar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </section>
  );
}

export default PendingActionsWidget;
