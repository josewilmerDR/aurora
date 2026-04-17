import { useState, useEffect, useCallback } from 'react';
import { FiActivity, FiRefreshCw, FiAlertCircle } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import { translateApiError } from '../lib/errorMessages';
import './AutopilotHealthPanel.css';

const WINDOW_OPTIONS = [
  { hours: 1,  label: '1 h' },
  { hours: 24, label: '24 h' },
  { hours: 168, label: '7 d' },
];

const STATUS_LABELS = {
  executed:  'Ejecutadas',
  failed:    'Fallidas',
  proposed:  'Propuestas',
  approved:  'Aprobadas',
  rejected:  'Rechazadas',
  escalated: 'Escaladas',
};

const TYPE_LABELS = {
  crear_tarea:            'Crear tarea',
  reprogramar_tarea:      'Reprogramar',
  reasignar_tarea:        'Reasignar',
  ajustar_inventario:     'Corregir inventario',
  enviar_notificacion:    'Notificación',
  crear_solicitud_compra: 'Solicitud de compra',
  crear_orden_compra:     'Orden de compra',
};

export default function AutopilotHealthPanel() {
  const apiFetch = useApiFetch();
  const [windowHours, setWindowHours] = useState(24);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async (hours) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/autopilot/health?windowHours=${hours}&failuresLimit=10`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(translateApiError(body));
      }
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { refresh(windowHours); }, [windowHours, refresh]);

  const summary = data?.summary;
  const failures = data?.recentFailures || [];

  const successRatePct = summary && summary.successRate != null
    ? Math.round(summary.successRate * 100)
    : null;

  return (
    <div className="ap-health">
      <div className="ap-health-header">
        <h3><FiActivity size={16} /> Salud del Piloto Automático</h3>
        <div className="ap-health-controls">
          <div className="ap-health-window">
            {WINDOW_OPTIONS.map(opt => (
              <button
                key={opt.hours}
                type="button"
                className={`ap-health-window-btn ${windowHours === opt.hours ? 'is-active' : ''}`}
                onClick={() => setWindowHours(opt.hours)}
                disabled={loading}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary ap-health-refresh"
            onClick={() => refresh(windowHours)}
            disabled={loading}
            aria-label="Refrescar"
          >
            <FiRefreshCw size={14} className={loading ? 'ap-health-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div className="ap-health-error">{error}</div>}

      {summary && (
        <>
          <div className="ap-health-kpis">
            <Kpi label="Acciones" value={summary.total} />
            <Kpi
              label="Éxito"
              value={successRatePct != null ? `${successRatePct}%` : '—'}
              tone={successRatePct == null ? 'neutral' : successRatePct >= 90 ? 'good' : successRatePct >= 70 ? 'warn' : 'bad'}
            />
            <Kpi
              label="Latencia media"
              value={summary.avgLatencyMs != null ? `${summary.avgLatencyMs} ms` : '—'}
            />
            <Kpi
              label="Fallidas"
              value={summary.byStatus?.failed || 0}
              tone={(summary.byStatus?.failed || 0) > 0 ? 'bad' : 'neutral'}
            />
          </div>

          <div className="ap-health-breakdown">
            <Breakdown title="Por estado" entries={summary.byStatus || {}} labels={STATUS_LABELS} />
            <Breakdown title="Por tipo de acción" entries={summary.byType || {}} labels={TYPE_LABELS} />
          </div>
        </>
      )}

      <div className="ap-health-failures">
        <h4><FiAlertCircle size={14} /> Últimas fallas</h4>
        {failures.length === 0 ? (
          <p className="ap-health-empty">Sin fallas registradas.</p>
        ) : (
          <ul>
            {failures.map(f => (
              <li key={f.id}>
                <div className="ap-health-failure-head">
                  <strong>{TYPE_LABELS[f.type] || f.type}</strong>
                  <span>{formatTs(f.executedAt)}</span>
                </div>
                {f.titulo && <div className="ap-health-failure-title">{f.titulo}</div>}
                {f.error && <div className="ap-health-failure-error">{f.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, tone = 'neutral' }) {
  return (
    <div className={`ap-health-kpi ap-health-kpi--${tone}`}>
      <span className="ap-health-kpi-value">{value}</span>
      <span className="ap-health-kpi-label">{label}</span>
    </div>
  );
}

function Breakdown({ title, entries, labels }) {
  const rows = Object.entries(entries).sort(([, a], [, b]) => b - a);
  if (rows.length === 0) return null;
  return (
    <div className="ap-health-breakdown-group">
      <h5>{title}</h5>
      <ul>
        {rows.map(([key, count]) => (
          <li key={key}>
            <span>{labels[key] || key}</span>
            <strong>{count}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTs(ts) {
  if (!ts) return '';
  const ms =
    typeof ts === 'object' && ts._seconds ? ts._seconds * 1000 :
    typeof ts === 'object' && ts.seconds  ? ts.seconds * 1000 :
    typeof ts === 'string'                 ? Date.parse(ts) :
    null;
  if (!ms) return '';
  return new Date(ms).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}
