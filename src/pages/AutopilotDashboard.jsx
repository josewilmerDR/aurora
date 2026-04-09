import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FiZap, FiRefreshCw, FiAlertTriangle, FiAlertCircle, FiInfo,
  FiPackage, FiCalendar, FiDroplet, FiActivity, FiGrid, FiClock, FiCpu,
} from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser, hasMinRole } from '../contexts/UserContext';
import './AutopilotDashboard.css';

// ── Constantes ────────────────────────────────────────────────────────────────

const MODE_LABELS = {
  off:    'Desactivado',
  nivel1: 'Nivel 1 — Recomendaciones',
  nivel2: 'Nivel 2 — Agencia Supervisada',
  nivel3: 'Nivel 3 — Agencia Total',
};

const CATEGORIA_ICONS = {
  inventario:   FiPackage,
  tareas:       FiCalendar,
  aplicaciones: FiDroplet,
  monitoreo:    FiActivity,
  general:      FiGrid,
};

const CATEGORIA_LABELS = {
  inventario:   'Inventario',
  tareas:       'Tareas',
  aplicaciones: 'Aplicaciones',
  monitoreo:    'Monitoreo',
  general:      'General',
};

const PRIORIDAD_ICONS = {
  alta:  FiAlertTriangle,
  media: FiAlertCircle,
  baja:  FiInfo,
};

function formatTimestamp(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-CR', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function SnapshotStat({ icon: Icon, label, value, accent }) {
  return (
    <div className={`ap-snapshot-stat${accent ? ` ap-snapshot-stat--${accent}` : ''}`}>
      <div className="ap-snapshot-stat-top">
        <span className="ap-snapshot-stat-value">{value ?? '—'}</span>
        <Icon size={16} className="ap-snapshot-stat-icon" />
      </div>
      <div className="ap-snapshot-stat-label">{label}</div>
    </div>
  );
}

function RecommendationCard({ rec }) {
  const [expanded, setExpanded] = useState(false);
  const CatIcon = CATEGORIA_ICONS[rec.categoria] || FiInfo;
  return (
    <div className={`ap-rec-card ap-rec-card--${rec.prioridad}`}>
      <div className="ap-rec-card-header" onClick={() => setExpanded(e => !e)}>
        <CatIcon size={14} className="ap-rec-cat-icon" />
        <span className="ap-rec-categoria">{CATEGORIA_LABELS[rec.categoria] || rec.categoria}</span>
        <span className="ap-rec-titulo">{rec.titulo}</span>
        <span className="ap-rec-expand">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="ap-rec-card-body">
          {rec.descripcion && <p className="ap-rec-descripcion">{rec.descripcion}</p>}
          {rec.contexto && (
            <div className="ap-rec-contexto">
              <span className="ap-rec-label">Contexto:</span>{rec.contexto}
            </div>
          )}
          {rec.accionSugerida && (
            <div className="ap-rec-accion">
              <span className="ap-rec-label">Acción sugerida:</span>{rec.accionSugerida}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function AutopilotDashboard() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();

  const [config, setConfig] = useState(null);
  const [latestSession, setLatestSession] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [configRes, sessionsRes] = await Promise.all([
          apiFetch('/api/autopilot/config'),
          apiFetch('/api/autopilot/sessions'),
        ]);
        if (cancelled) return;
        const [configData, sessionsData] = await Promise.all([
          configRes.json(),
          sessionsRes.json(),
        ]);
        setConfig(configData);
        if (Array.isArray(sessionsData) && sessionsData.length > 0) {
          // La sesión ligera no tiene recommendations[]; cargar la primera completa
          const firstId = sessionsData[0].id;
          const sessionRes = await apiFetch(`/api/autopilot/sessions/${firstId}`);
          if (!cancelled) {
            const sessionData = await sessionRes.json();
            setLatestSession(sessionData);
          }
        }
      } catch (err) {
        if (!cancelled) setError('No se pudo cargar la información del Piloto Automático.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await apiFetch('/api/autopilot/analyze', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al analizar');
      setLatestSession({
        id: data.sessionId,
        timestamp: data.timestamp,
        recommendations: data.recommendations,
        snapshot: data.snapshot,
        status: 'completed',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const mode = config?.mode || 'off';
  const canConfig = hasMinRole(currentUser?.rol, 'supervisor');

  const recommendations = latestSession?.recommendations || [];
  const byPriority = (p) => recommendations.filter(r => r.prioridad === p);

  return (
    <div className="ap-page">

      {/* ── Header ── */}
      <div className="ap-header">
        <div className="ap-header-left">
          <h1 className="ap-title"><FiCpu size={18} /> Piloto Automático</h1>
          <span className={`ap-mode-badge ap-mode-badge--${mode}`}>
            {MODE_LABELS[mode] || mode}
          </span>
        </div>
        <div className="ap-header-right">
          {latestSession?.timestamp && (
            <span className="ap-last-run">
              <FiClock size={12} />
              {formatTimestamp(latestSession.timestamp)}
            </span>
          )}
          <button
            className="ap-analyze-btn"
            onClick={handleAnalyze}
            disabled={analyzing || mode === 'off' || loading}
          >
            <FiRefreshCw size={14} className={analyzing ? 'ap-spin' : ''} />
            {analyzing ? 'Analizando...' : 'Analizar Ahora'}
          </button>
          {canConfig && (
            <Link to="/autopilot/configuracion" className="ap-config-link">
              Configurar
            </Link>
          )}
        </div>
      </div>

      {/* ── Notice: modo OFF ── */}
      {!loading && mode === 'off' && (
        <div className="ap-notice ap-notice--off">
          <FiInfo size={15} />
          El Piloto Automático está desactivado.
          {canConfig
            ? <> Ve a <Link to="/autopilot/configuracion" style={{ color: 'inherit', textDecoration: 'underline' }}>Configuración</Link> para activarlo.</>
            : ' Pídele a un Supervisor que lo active en Configuración.'
          }
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="ap-notice ap-notice--error">
          <FiAlertTriangle size={15} /> {error}
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !latestSession && mode !== 'off' && (
        <div className="ap-empty">
          <FiZap size={40} className="ap-empty-icon" />
          <p>Todavía no se ha realizado ningún análisis.</p>
          <p className="ap-empty-sub">Presiona "Analizar Ahora" para recibir recomendaciones personalizadas.</p>
        </div>
      )}

      {/* ── Snapshot bar ── */}
      {latestSession?.snapshot && (
        <div className="ap-snapshot-bar">
          <SnapshotStat
            icon={FiAlertTriangle}
            label="Tareas vencidas"
            value={latestSession.snapshot.overdueTasksCount}
            accent={latestSession.snapshot.overdueTasksCount > 0 ? 'magenta' : undefined}
          />
          <SnapshotStat
            icon={FiCalendar}
            label="Próximas 14 días"
            value={latestSession.snapshot.upcomingTasksCount}
          />
          <SnapshotStat
            icon={FiPackage}
            label="Stock bajo"
            value={latestSession.snapshot.lowStockCount}
            accent={latestSession.snapshot.lowStockCount > 0 ? 'magenta' : undefined}
          />
          <SnapshotStat
            icon={FiActivity}
            label="Monitoreos (30d)"
            value={latestSession.snapshot.recentMonitoreosCount}
          />
          <SnapshotStat
            icon={FiGrid}
            label="Lotes activos"
            value={latestSession.snapshot.activeLotesCount}
          />
        </div>
      )}

      {/* ── Recomendaciones agrupadas por prioridad ── */}
      {recommendations.length > 0 && (
        <div className="ap-recs">
          {['alta', 'media', 'baja'].map(prioridad => {
            const group = byPriority(prioridad);
            if (!group.length) return null;
            const PrioIcon = PRIORIDAD_ICONS[prioridad];
            return (
              <div key={prioridad} className="ap-rec-group">
                <h2 className={`ap-rec-group-title ap-rec-group-title--${prioridad}`}>
                  <PrioIcon size={13} />
                  Prioridad {prioridad.charAt(0).toUpperCase() + prioridad.slice(1)}
                </h2>
                {group.map(rec => <RecommendationCard key={rec.id} rec={rec} />)}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
