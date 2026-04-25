import { useEffect, useState, useCallback } from 'react';
import { FiTarget, FiRefreshCw } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';

// Fase 6.5 — trust scores por dominio. Endpoint: GET /api/meta/trust/scores.
// Admin puede disparar recompute manual (POST /api/meta/trust/recompute).

const DOMAIN_LABELS = {
  finance: 'Finanzas',
  procurement: 'Abastecimiento',
  hr: 'RRHH',
  strategy: 'Estrategia',
  meta: 'Plan automático',
};

function ScoreBar({ score }) {
  const isNull = score == null;
  const pct = isNull ? 0 : Math.max(0, Math.min(1, score)) * 100;
  return (
    <div className="ceo-score-bar">
      <div
        className={isNull ? 'ceo-score-bar-fill ceo-score-bar-fill--null' : 'ceo-score-bar-fill'}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function TrustScoreWidget() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const canRecompute = hasMinRole(currentUser?.rol || 'trabajador', 'administrador');

  const [scores, setScores] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/meta/trust/scores')
      .then(r => r.json())
      .then(setScores)
      .catch(() => setError('No se pudieron cargar los aciertos por área.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      const res = await apiFetch('/api/meta/trust/recompute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError('No se pudo recalcular.');
    } finally {
      setRecomputing(false);
    }
  };

  const byDomain = scores?.byDomain || {};
  const observationCount = scores?.observationCount ?? 0;

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiTarget size={14} /> Aciertos por área</span>
        <button type="button" className="btn-icon" onClick={load} disabled={loading} title="Recargar">
          <FiRefreshCw size={12} />
        </button>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && scores && (
        <>
          <div>
            <div className="fin-widget-sub">
              {observationCount > 0
                ? `${observationCount} decisiones evaluadas en los últimos ${scores.sinceDays || 365} días · da más peso a las recientes`
                : 'Aún no hay datos. El Copilot revisa cada día qué tan acertadas fueron sus decisiones.'}
            </div>
          </div>

          <div>
            {Object.entries(DOMAIN_LABELS).map(([key, label]) => {
              const d = byDomain[key] || { score: null, confidence: 0, sampleSize: 0 };
              return (
                <div className="ceo-score-row" key={key}>
                  <span className="ceo-score-label">{label}</span>
                  <ScoreBar score={d.score} />
                  <span className={d.score == null ? 'ceo-score-value ceo-score-value--null' : 'ceo-score-value'}>
                    {d.score == null ? '—' : d.score.toFixed(2)}
                  </span>
                  <span className="ceo-score-meta" style={{ gridColumn: '1 / -1' }}>
                    confianza {(d.confidence || 0).toFixed(2)} · basado en {d.sampleSize || 0} decisiones
                  </span>
                </div>
              );
            })}
          </div>

          {canRecompute && (
            <div style={{ marginTop: 'auto' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleRecompute}
                disabled={recomputing}
                style={{ width: '100%' }}
              >
                {recomputing ? 'Calculando…' : 'Recalcular y sugerir ajustes'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default TrustScoreWidget;
