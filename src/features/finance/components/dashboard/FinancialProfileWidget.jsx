import { useEffect, useState, useCallback } from 'react';
import { FiFileText, FiRefreshCw } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useApiFetch } from '../../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../../contexts/UserContext';

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
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
};

// Widget del perfil financiero. Muestra los últimos snapshots y expone un
// botón para generar uno nuevo (solo administrador).
function FinancialProfileWidget() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const canGenerate = hasMinRole(currentUser?.rol || 'trabajador', 'administrador');

  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/financing/profile/snapshots')
      .then(r => r.json())
      .then(data => setSnapshots(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudieron cargar los snapshots.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await apiFetch('/api/financing/profile/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError('No se pudo generar el snapshot.');
    } finally {
      setGenerating(false);
    }
  };

  const latest = snapshots[0];

  return (
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiFileText size={14} /></span>
        <h3 className="aur-section-title">Perfil financiero</h3>
        <span className="aur-section-count">Snapshots inmutables</span>
      </div>

      {loading && <div className="fin-widget-loading">Cargando…</div>}
      {error && <div className="fin-widget-error">{error}</div>}

      {!loading && !error && (
        <>
          {latest ? (
            <>
              <div>
                <div className="fin-widget-primary">{fmtMoney(latest.totalAssets)}</div>
                <div className="fin-widget-sub">Activos totales — corte {latest.asOf}</div>
              </div>
              <div className="fin-widget-stats">
                <div>
                  <span>Patrimonio</span>
                  <strong>{fmtMoney(latest.totalEquity)}</strong>
                </div>
                <div>
                  <span>Revenue 12m</span>
                  <strong>{fmtMoney(latest.revenue)}</strong>
                </div>
                <div>
                  <span>Snapshots</span>
                  <strong>{snapshots.length}</strong>
                </div>
              </div>
              <div className="fin-recent-list">
                {snapshots.slice(0, 3).map(s => (
                  <div key={s.id} className="fin-recent-row">
                    <span>{fmtDate(s.generatedAt)}</span>
                    <span className="aur-badge aur-badge--gray">corte {s.asOf}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="fin-widget-empty">
              Aún no hay snapshots. Genera el primero para tener un corte auditable.
            </div>
          )}

          {canGenerate && (
            <div className="fin-widget-cta-row">
              <button
                type="button"
                className="aur-btn-pill"
                onClick={handleGenerate}
                disabled={generating}
              >
                <FiRefreshCw size={14} /> {generating ? 'Generando…' : 'Generar snapshot'}
              </button>
              {latest && (
                <Link
                  to={`/finance/financing/snapshots/${latest.id}`}
                  className="aur-btn-text"
                >
                  Ver último
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default FinancialProfileWidget;
