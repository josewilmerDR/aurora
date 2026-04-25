import { useEffect, useState, useCallback } from 'react';
import { FiLink2, FiRefreshCw, FiChevronRight } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

// Fase 6.5 — historial de cadenas cross-domain. Endpoint:
// GET /api/autopilot/orchestrator/chains. Detalle expandible al click.

const STATUS_LABELS = {
  planned: 'planeada',
  executing: 'en curso',
  executed: 'hecha',
  partial: 'a medias',
  aborted: 'cancelada',
  rolled_back: 'deshecha',
};

function StatusBadge({ status }) {
  const key = status || 'planned';
  return (
    <span className={`ceo-status-badge ceo-status-badge--${key}`}>
      {STATUS_LABELS[key] || key.replace(/_/g, ' ')}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return ''; }
}

function ChainHistoryWidget() {
  const apiFetch = useApiFetch();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/autopilot/orchestrator/chains?limit=10')
      .then(r => r.json())
      .then(data => setRows(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudieron cargar las tareas en cadena.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const expand = async (chainId) => {
    if (expandedId === chainId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(chainId);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await apiFetch(`/api/autopilot/orchestrator/chains/${chainId}`);
      if (!res.ok) throw new Error();
      setDetail(await res.json());
    } catch {
      setDetail({ error: 'No se pudo cargar el detalle.' });
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiLink2 size={14} /> Tareas en cadena recientes</span>
        <button type="button" className="btn-icon" onClick={load} disabled={loading} title="Recargar">
          <FiRefreshCw size={12} />
        </button>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && (
        rows.length === 0 ? (
          <div className="fin-widget-empty">
            Aún no hay tareas en cadena. Una cadena es cuando el Copilot une varias acciones para resolver algo grande
            (ejemplo: si la caja baja → revisa gastos, posterga compras y reasigna personal).
          </div>
        ) : (
          <div style={{ overflowY: 'auto', maxHeight: 280 }}>
            {rows.map(r => (
              <div key={r.id}>
                <div
                  className="ceo-chain-row"
                  onClick={() => expand(r.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div>
                    <div className="ceo-chain-objective">{r.objective || '(sin meta definida)'}</div>
                    <div className="ceo-chain-meta">
                      {fmtDate(r.createdAt)} · {r.stepCount} pasos · nivel {r.effectiveLevel || 'n/a'}
                      {r.usedClaude ? ' · revisado por IA' : ''}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                  <FiChevronRight
                    size={14}
                    style={{
                      transform: expandedId === r.id ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.15s',
                      opacity: 0.6,
                    }}
                  />
                </div>

                {expandedId === r.id && (
                  <div style={{ padding: '8px 12px 12px 12px', fontSize: '0.78rem', opacity: 0.85 }}>
                    {detailLoading && <div>Cargando detalle…</div>}
                    {detail?.error && <div className="fin-widget-error">{detail.error}</div>}
                    {detail && !detail.error && (
                      <>
                        {detail.plan?.overallRationale && (
                          <div style={{ marginBottom: 8 }}>
                            <em>{detail.plan.overallRationale}</em>
                          </div>
                        )}
                        {Array.isArray(detail.plan?.steps) && detail.plan.steps.map(s => {
                          const exec = detail.execution?.perStep?.find(e => e.stepId === s.id);
                          return (
                            <div key={s.id} style={{ marginBottom: 4 }}>
                              <span className="ceo-domain-chip">{s.id}</span>{' '}
                              <strong>{s.actionType}</strong>{' '}
                              {exec && (
                                <span className={`ceo-status-badge ceo-status-badge--${exec.status}`}>
                                  {exec.status}
                                </span>
                              )}
                              <div style={{ opacity: 0.7, marginLeft: 4 }}>{s.rationale}</div>
                            </div>
                          );
                        })}
                        {detail.execution?.rollback && (
                          <div style={{ marginTop: 8, color: '#ff8080' }}>
                            Pasos deshechos: {detail.execution.rollback.fullyApplied ? 'todos' : 'parcialmente'} —
                            disparado por <code>{detail.execution.rollback.triggeredByStepId || 'cancelación'}</code>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

export default ChainHistoryWidget;
