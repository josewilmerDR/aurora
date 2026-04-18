import { useEffect, useMemo, useState } from 'react';
import { FiAward } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

function currentPeriodYYYYMM() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Supervisor-only widget: lists monthly scores for every worker with a
// ficha. lowConfidence workers are shown with a dimmed row + tag so the
// viewer sees the flag even when the score itself looks low.
function PerformanceScoreTable() {
  const apiFetch = useApiFetch();
  const [period, setPeriod] = useState(currentPeriodYYYYMM());
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch(`/api/hr/performance?period=${period}`)
      .then(r => r.json())
      .then(data => setRows(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudo cargar el ranking.'))
      .finally(() => setLoading(false));
  }, [apiFetch, period]);

  const sorted = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => (b.score || 0) - (a.score || 0));
  }, [rows]);

  return (
    <div className="hr-widget hr-widget--wide">
      <div className="hr-widget-header">
        <span className="hr-widget-title"><FiAward size={14} /> Scores mensuales</span>
        <input
          className="hr-period-input"
          type="month"
          value={period}
          onChange={e => setPeriod(e.target.value)}
        />
      </div>

      {loading && <div className="hr-widget-loading">Cargando…</div>}
      {error && <div className="hr-widget-loading hr-widget-error">{error}</div>}
      {!loading && !error && sorted.length === 0 && (
        <div className="hr-widget-empty">Sin scores calculados para este período.</div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="hr-score-table">
          <div className="hr-score-row hr-score-row--head">
            <span>Trabajador</span>
            <span>Score</span>
            <span>Completion</span>
            <span>Puntualidad</span>
            <span>Asistencia</span>
            <span>Maquinaria</span>
            <span>n</span>
          </div>
          {sorted.map(row => (
            <div
              key={row.id || row.userId}
              className={`hr-score-row ${row.lowConfidence ? 'hr-score-row--low-conf' : ''}`}
            >
              <span className="hr-score-user">
                {row.userId}
                {row.lowConfidence && <span className="hr-tag hr-tag--warn">low-conf</span>}
              </span>
              <span className="hr-score-value">{row.score?.toFixed?.(1) ?? '—'}</span>
              <span>{row.subscores?.completionRate?.toFixed?.(0) ?? '—'}</span>
              <span>{row.subscores?.punctuality?.toFixed?.(0) ?? '—'}</span>
              <span>{row.subscores?.attendance?.toFixed?.(0) ?? '—'}</span>
              <span>{row.subscores?.machineUtilization?.toFixed?.(0) ?? '—'}</span>
              <span className="hr-score-n">{row.sampleSize ?? 0}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PerformanceScoreTable;
