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
      setError('No se pudieron cargar los cambios propuestos.');
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
      setError(`No se pudo ${action === 'approve' ? 'aprobar' : 'rechazar'} el cambio.`);
    } finally {
      setActingId(null);
    }
  };

  const pending = proposals.filter(p => p.status === 'proposed');
  const executed = proposals.filter(p => p.status === 'executed').slice(0, 3);

  return (
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiSliders size={14} /></span>
        <h3 className="aur-section-title">Ajustes propuestos a las reglas</h3>
        <div className="aur-section-actions">
          <button type="button" className="aur-icon-btn" onClick={load} disabled={loading} title="Recargar">
            <FiRefreshCw size={14} />
          </button>
        </div>
      </div>

      {loading && <div className="ceo-widget-loading">Cargando…</div>}
      {error && <div className="ceo-widget-error">{error}</div>}

      {!loading && !error && (
        <>
          <div>
            <div className="ceo-widget-primary">
              {pending.length}
            </div>
            <div className="ceo-widget-sub">
              Cambios pendientes · {executed.length} aplicados recientemente · {corridor.length} reglas configurables
            </div>
          </div>

          <div className="ceo-guardrails-grid">
            {/* Pending proposals */}
            <div className="ceo-guardrails-scroll">
              <div className="ceo-guardrails-col-title">Cambios pendientes</div>
              {pending.length === 0 ? (
                <div className="ceo-widget-empty ceo-guardrails-empty">
                  Sin cambios propuestos por ahora.
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
                        aciertos {p.trustInput?.trust?.toFixed?.(2) ?? '—'} · confianza {p.trustInput?.confidence?.toFixed?.(2) ?? '—'}
                      </div>
                      {canActOnProposals && (
                        <div className="ceo-proposal-actions">
                          <button
                            type="button"
                            className="aur-btn-pill aur-btn-pill--sm"
                            disabled={actingId === p.id}
                            onClick={() => handleAction(p.id, 'approve')}
                          >
                            <FiCheck size={12} /> Aprobar
                          </button>
                          <button
                            type="button"
                            className="aur-btn-text"
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
            <div className="ceo-guardrails-scroll">
              <div className="ceo-guardrails-col-title">Rangos permitidos (mín / actual / máx)</div>
              {corridor.map(c => (
                <div key={c.key} className="ceo-corridor-row">
                  <div className="ceo-corridor-key">{c.key}</div>
                  <div className="ceo-corridor-values">
                    {fmtValue(c.floor, c.unit)} / <strong>{fmtValue(c.default, c.unit)}</strong> / {fmtValue(c.ceiling, c.unit)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default DynamicGuardrailsWidget;
