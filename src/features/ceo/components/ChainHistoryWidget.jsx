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
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiLink2 size={14} /></span>
        <h3 className="aur-section-title">Tareas en cadena recientes</h3>
        <div className="aur-section-actions">
          <button type="button" className="aur-icon-btn" onClick={load} disabled={loading} title="Recargar">
            <FiRefreshCw size={14} />
          </button>
        </div>
      </div>

      {loading && <div className="ceo-widget-loading">Cargando…</div>}
      {error && <div className="ceo-widget-error">{error}</div>}

      {!loading && !error && (
        rows.length === 0 ? (
          <div className="ceo-widget-empty">
            Aún no hay tareas en cadena. Una cadena es cuando el Copilot une varias acciones para resolver algo grande
            (ejemplo: si la caja baja → revisa gastos, posterga compras y reasigna personal).
          </div>
        ) : (
          <div className="ceo-chain-scroll">
            {rows.map(r => (
              <div key={r.id}>
                <button
                  type="button"
                  className="ceo-chain-row"
                  onClick={() => expand(r.id)}
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
                    className={`ceo-chain-chevron${expandedId === r.id ? ' ceo-chain-chevron--open' : ''}`}
                  />
                </button>

                {expandedId === r.id && (
                  <div className="ceo-chain-detail">
                    {detailLoading && <div>Cargando detalle…</div>}
                    {detail?.error && <div className="ceo-widget-error">{detail.error}</div>}
                    {detail && !detail.error && (
                      <>
                        {detail.plan?.overallRationale && (
                          <div className="ceo-chain-rationale">
                            <em>{detail.plan.overallRationale}</em>
                          </div>
                        )}
                        {Array.isArray(detail.plan?.steps) && detail.plan.steps.map(s => {
                          const exec = detail.execution?.perStep?.find(e => e.stepId === s.id);
                          return (
                            <div key={s.id} className="ceo-chain-step">
                              <span className="ceo-domain-chip">{s.id}</span>{' '}
                              <strong>{s.actionType}</strong>{' '}
                              {exec && (
                                <span className={`ceo-status-badge ceo-status-badge--${exec.status}`}>
                                  {exec.status}
                                </span>
                              )}
                              <div className="ceo-chain-step-rationale">{s.rationale}</div>
                            </div>
                          );
                        })}
                        {detail.execution?.rollback && (
                          <div className="ceo-chain-rollback">
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
    </section>
  );
}

export default ChainHistoryWidget;
