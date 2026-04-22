import { useCallback, useEffect, useState } from 'react';
import { FiClock, FiCheck, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

// Shows procurement autopilot actions awaiting approval (status=proposed
// and categoria=procurement). Inline approve/reject — no modal — to keep
// the widget dense. The dedicated Autopilot Dashboard remains available
// for richer flows (rollback, reasoning inspection, etc.).

function PriorityPill({ prioridad }) {
  const color = prioridad === 'alta' ? '#ff8080' : prioridad === 'media' ? '#ffd166' : '#66b3ff';
  return (
    <span className="fin-widget-sub" style={{ color, fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem' }}>
      {prioridad || 'media'}
    </span>
  );
}

function PendingActionsWidget() {
  const apiFetch = useApiFetch();
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // actionId currently being processed

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
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiClock size={14} /> Aprobaciones abastecimiento</span>
        <span className="fin-widget-sub">{actions.length} pendiente(s)</span>
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
                  <span className="fin-widget-sub" style={{ gridColumn: '1 / -1' }}>
                    {a.type === 'crear_orden_compra' ? 'OC' : 'Solicitud'}
                    {estimated ? ` · ~$${Number(estimated).toFixed(0)}` : ''}
                    {a.procurementSupplier?.name ? ` · ${a.procurementSupplier.name}` : ''}
                  </span>
                  <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      onClick={() => handle(a.id, 'approve')}
                      disabled={busy === a.id}
                      style={btnStyle('#33ff99')}
                    >
                      <FiCheck size={12} /> Aprobar
                    </button>
                    <button
                      onClick={() => handle(a.id, 'reject')}
                      disabled={busy === a.id}
                      style={btnStyle('#ff8080')}
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
    </div>
  );
}

function btnStyle(color) {
  return {
    background: 'transparent',
    border: `1px solid ${color}`,
    color,
    padding: '3px 10px',
    borderRadius: 4,
    fontSize: '0.75rem',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  };
}

export default PendingActionsWidget;
