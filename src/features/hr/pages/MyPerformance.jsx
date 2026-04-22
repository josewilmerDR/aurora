import { useEffect, useState } from 'react';
import { FiUser } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import '../styles/performance-dashboard.css';

function currentPeriodYYYYMM() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Worker self-view. Calls /api/hr/performance/:userId which the
// backend (routes/hr.js) already redacts for non-supervisor roles —
// weights and details are stripped. This page never shows a ranking
// or peer comparison by design.
function MyPerformance() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const [period, setPeriod] = useState(currentPeriodYYYYMM());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const uid = currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    apiFetch(`/api/hr/performance/${uid}?period=${period}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('No se pudo cargar tu score.'))
      .finally(() => setLoading(false));
  }, [apiFetch, uid, period]);

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiUser /> Mi desempeño</h2>
      </div>

      <p className="hr-widget-sub" style={{ marginBottom: 16 }}>
        Tu score mensual y subscores. La comparación con pares no se muestra — consulta a tu supervisor
        si quieres contexto sobre cómo se calcula.
      </p>

      <div className="hr-widget-header" style={{ maxWidth: 520, marginBottom: 16 }}>
        <span className="hr-widget-sub">Período</span>
        <input
          className="hr-period-input"
          type="month"
          value={period}
          onChange={e => setPeriod(e.target.value)}
        />
      </div>

      {loading && <div className="hr-widget-loading">Cargando…</div>}
      {error && <div className="hr-widget-loading hr-widget-error">{error}</div>}
      {!loading && !error && !data && (
        <div className="hr-widget-empty">Sin score calculado para este período todavía.</div>
      )}

      {!loading && !error && data && (
        <div className="hr-self-card">
          <div>
            <div className="hr-self-score">{data.score?.toFixed?.(1) ?? '—'}</div>
            <div className="hr-widget-sub">de 100</div>
          </div>

          {data.lowConfidence && (
            <div>
              <span className="hr-tag hr-tag--warn">low-conf</span>
              <span className="hr-widget-sub" style={{ marginLeft: 8 }}>
                Muestra pequeña ({data.sampleSize} tareas). El score se calculó pero no se usa en
                comparaciones ni alertas este mes.
              </span>
            </div>
          )}

          <div className="hr-self-subscores">
            <div className="hr-self-subscore">
              <span>Completion</span>
              <strong>{data.subscores?.completionRate?.toFixed?.(0) ?? '—'}</strong>
            </div>
            <div className="hr-self-subscore">
              <span>Puntualidad</span>
              <strong>{data.subscores?.punctuality?.toFixed?.(0) ?? '—'}</strong>
            </div>
            <div className="hr-self-subscore">
              <span>Asistencia</span>
              <strong>{data.subscores?.attendance?.toFixed?.(0) ?? '—'}</strong>
            </div>
            <div className="hr-self-subscore">
              <span>Maquinaria</span>
              <strong>{data.subscores?.machineUtilization?.toFixed?.(0) ?? '—'}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MyPerformance;
