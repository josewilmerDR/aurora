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
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiTarget size={14} /></span>
        <h3 className="aur-section-title">Aciertos por área</h3>
        <div className="aur-section-actions">
          <button type="button" className="aur-icon-btn" onClick={load} disabled={loading} title="Recargar">
            <FiRefreshCw size={14} />
          </button>
        </div>
      </div>

      {loading && <div className="ceo-widget-loading">Cargando…</div>}
      {error && <div className="ceo-widget-error">{error}</div>}

      {!loading && !error && scores && (
        <>
          <div className="ceo-widget-sub">
            {observationCount > 0
              ? `${observationCount} decisiones evaluadas en los últimos ${scores.sinceDays || 365} días · da más peso a las recientes`
              : 'Aún no hay datos. El Copilot revisa cada día qué tan acertadas fueron sus decisiones.'}
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
                  <span className="ceo-score-meta ceo-score-meta--row">
                    confianza {(d.confidence || 0).toFixed(2)} · basado en {d.sampleSize || 0} decisiones
                  </span>
                </div>
              );
            })}
          </div>

          {canRecompute && (
            <div className="ceo-widget-cta-row">
              <button
                type="button"
                className="aur-btn-pill"
                onClick={handleRecompute}
                disabled={recomputing}
              >
                {recomputing ? 'Calculando…' : 'Recalcular y sugerir ajustes'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default TrustScoreWidget;
