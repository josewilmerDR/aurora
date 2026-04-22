import { useEffect, useState, useCallback } from 'react';
import { FiSliders, FiRefreshCw, FiCheck, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';

// Fase 6.5 — propuestas pendientes + corridor. Endpoints:
// GET /api/meta/guardrails/proposals, GET /api/meta/trust/corridor,
// POST /api/meta/guardrails/proposals/:id/approve|reject.

function fmtValue(v, unit) {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (unit === 'percent') return `${n}%`;
  if (unit === 'USD') return `$${n.toLocaleString('en-US')}`;
  return n.toLocaleString('en-US');
}

function DynamicGuardrailsWidget() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const canActOnProposals = hasMinRole(currentUser?.rol || 'trabajador', 'administrador');

  const [proposals, setProposals] = useState([]);
  const [corridor, setCorridor] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actingId, setActingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes] = await Promise.all([
        apiFetch('/api/meta/guardrails/proposals?limit=20'),
        apiFetch('/api/meta/trust/corridor'),
      ]);
      const p = pRes.ok ? await pRes.json() : [];
      const c = cRes.ok ? await cRes.json() : { entries: [] };
      setProposals(Array.isArray(p) ? p : []);
      setCorridor(Array.isArray(c.entries) ? c.entries : []);
      setError(null);
    } catch {
      setError('No se pudieron cargar las propuestas.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id, action, reason = '') => {
    setActingId(id);
    try {
      const res = await apiFetch(`/api/meta/guardrails/proposals/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'reject' ? { reason } : {}),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError(`No se pudo ${action === 'approve' ? 'aprobar' : 'rechazar'} la propuesta.`);
    } finally {
      setActingId(null);
    }
  };

  const pending = proposals.filter(p => p.status === 'proposed');
  const executed = proposals.filter(p => p.status === 'executed').slice(0, 3);

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiSliders size={14} /> Guardrails dinámicos</span>
        <button type="button" className="btn-icon" onClick={load} disabled={loading} title="Recargar">
          <FiRefreshCw size={12} />
        </button>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && (
        <>
          <div>
            <div className="fin-widget-primary" style={{ fontSize: '1.4rem' }}>
              {pending.length}
            </div>
            <div className="fin-widget-sub">
              Propuestas pendientes · {executed.length} ejecutadas reciente · corridor con {corridor.length} knobs
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, overflow: 'hidden' }}>
            {/* Pending proposals */}
            <div style={{ overflowY: 'auto', maxHeight: 200 }}>
              <div className="ceo-score-meta" style={{ marginBottom: 6, textTransform: 'uppercase' }}>
                Propuestas pendientes
              </div>
              {pending.length === 0 ? (
                <div className="fin-widget-empty" style={{ padding: '8px 0' }}>
                  Sin propuestas pendientes.
                </div>
              ) : (
                pending.map(p => (
                  <div className="ceo-proposal-row" key={p.id}>
                    <div>
                      <div className="ceo-proposal-key">{p.key}</div>
                      <div className={`ceo-proposal-change ceo-proposal-change--${p.direction}`}>
                        {fmtValue(p.currentValue, p.unit)} → {fmtValue(p.proposedValue, p.unit)}
                      </div>
                      <div className="ceo-score-meta">
                        trust {p.trustInput?.trust?.toFixed?.(2) ?? '—'} · confianza {p.trustInput?.confidence?.toFixed?.(2) ?? '—'}
                      </div>
                      {canActOnProposals && (
                        <div className="ceo-proposal-actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={actingId === p.id}
                            onClick={() => handleAction(p.id, 'approve')}
                          >
                            <FiCheck size={12} /> Aprobar
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={actingId === p.id}
                            onClick={() => handleAction(p.id, 'reject')}
                          >
                            <FiX size={12} /> Rechazar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Corridor reference */}
            <div style={{ overflowY: 'auto', maxHeight: 200 }}>
              <div className="ceo-score-meta" style={{ marginBottom: 6, textTransform: 'uppercase' }}>
                Corridor (floor / default / ceiling)
              </div>
              {corridor.map(c => (
                <div key={c.key} style={{ fontSize: '0.76rem', padding: '4px 0', borderBottom: '1px dashed var(--aurora-border)' }}>
                  <div style={{ color: 'var(--aurora-light)', fontWeight: 500 }}>{c.key}</div>
                  <div style={{ opacity: 0.65, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtValue(c.floor, c.unit)} / <strong>{fmtValue(c.default, c.unit)}</strong> / {fmtValue(c.ceiling, c.unit)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DynamicGuardrailsWidget;
