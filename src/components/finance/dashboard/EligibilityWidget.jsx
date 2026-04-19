import { useEffect, useState } from 'react';
import { FiCheckSquare } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

const fmtMoney = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  } catch { return iso; }
};

const scoreBadge = (score) => {
  if (score == null) return null;
  if (score >= 0.75) return { label: 'Elegible', cls: 'fin-badge--ok' };
  if (score >= 0.5) return { label: 'Revisar', cls: 'fin-badge--warn' };
  return { label: 'No elegible', cls: 'fin-badge--bad' };
};

function EligibilityWidget() {
  const apiFetch = useApiFetch();
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/api/financing/eligibility')
      .then(r => r.json())
      .then(data => setAnalyses(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudieron cargar los análisis.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const top = analyses.slice(0, 5);

  return (
    <div className="fin-widget">
      <div className="fin-widget-header">
        <span className="fin-widget-title"><FiCheckSquare size={14} /> Análisis de elegibilidad</span>
        <span className="fin-widget-sub">{analyses.length ? `${analyses.length} recientes` : ''}</span>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-loading fin-widget-error">{error}</div>}

      {!loading && !error && (
        <>
          {top.length === 0 ? (
            <div className="fin-widget-empty">
              Sin análisis aún. Un administrador puede lanzar uno desde un snapshot financiero.
            </div>
          ) : (
            <div className="fin-recent-list">
              {top.map(a => {
                const badge = scoreBadge(a.topScore);
                return (
                  <div key={a.id} className="fin-recent-row">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <strong>{fmtMoney(a.targetAmount)}</strong>
                      <span className="fin-widget-sub">
                        {a.targetUse || 'sin uso especificado'} · {fmtDate(a.createdAt)}
                      </span>
                    </div>
                    {badge && (
                      <span className={`fin-badge ${badge.cls}`}>
                        {badge.label} · {(a.topScore * 100).toFixed(0)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default EligibilityWidget;
