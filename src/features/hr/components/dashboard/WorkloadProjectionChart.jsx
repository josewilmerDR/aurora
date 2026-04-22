import { useEffect, useMemo, useState } from 'react';
import { FiBarChart2 } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

// Stacked bars per week: demand (soft, estimatedPersonHours) vs baseline
// capacity. Supervisor-only like the rest of the dashboard.
function WorkloadProjectionChart() {
  const apiFetch = useApiFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/api/hr/workload-projection?horizonWeeks=12')
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('No se pudo cargar la proyección.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const chart = useMemo(() => {
    if (!data?.weeks) return null;
    const maxDemand = Math.max(
      ...data.weeks.map(w => w.estimatedPersonHours || 0),
      data.capacity?.baselineWeeklyHours || 0,
      1,
    );
    return { maxDemand, weeks: data.weeks };
  }, [data]);

  return (
    <div className="hr-widget hr-widget--wide">
      <div className="hr-widget-header">
        <span className="hr-widget-title"><FiBarChart2 size={14} /> Proyección de carga (12s)</span>
        {data?.capacity && (
          <span className="hr-widget-sub">
            Capacidad: {data.capacity.baselineWeeklyHours}h/sem · {data.capacity.permanentCount} permanentes
          </span>
        )}
      </div>

      {loading && <div className="hr-widget-loading">Cargando…</div>}
      {error && <div className="hr-widget-loading hr-widget-error">{error}</div>}
      {!loading && !error && data && (
        <>
          <p className="hr-widget-sub" style={{ marginTop: 0 }}>
            Horas estimadas por actividad: {data.assumptions?.defaultActivityHours}h (supuesto).
            Actividades sin duración explícita — usa la vista para alinear expectativas, no como verdad.
          </p>
          <div className="hr-workload-chart">
            {chart && chart.weeks.map(w => {
              const demandPct = Math.min(100, (w.estimatedPersonHours / chart.maxDemand) * 100);
              const capPct = data.capacity?.baselineWeeklyHours
                ? Math.min(100, (data.capacity.baselineWeeklyHours / chart.maxDemand) * 100)
                : 0;
              const overflow = w.estimatedPersonHours > (data.capacity?.baselineWeeklyHours || 0);
              return (
                <div key={w.weekStart} className="hr-workload-bar">
                  <div className="hr-workload-bar-track">
                    <div
                      className="hr-workload-bar-capacity"
                      style={{ height: `${capPct}%` }}
                      title={`Capacidad ${data.capacity?.baselineWeeklyHours}h`}
                    />
                    <div
                      className={`hr-workload-bar-demand ${overflow ? 'hr-workload-bar-demand--over' : ''}`}
                      style={{ height: `${demandPct}%` }}
                      title={`Demanda ~${w.estimatedPersonHours}h (${w.totalActivities} actividades)`}
                    />
                  </div>
                  <span className="hr-workload-bar-label">{w.weekStart.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default WorkloadProjectionChart;
