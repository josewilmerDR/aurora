import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FiZap, FiRefreshCw, FiAlertTriangle, FiAlertCircle, FiInfo,
  FiPackage, FiCalendar, FiDroplet, FiActivity, FiGrid, FiClock, FiCpu,
  FiCheck, FiX, FiSend,
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

const ACTION_TYPE_LABELS = {
  crear_tarea:        'Crear tarea',
  reprogramar_tarea:  'Reprogramar tarea',
  reasignar_tarea:    'Reasignar tarea',
  ajustar_inventario: 'Ajustar inventario',
  enviar_notificacion:'Enviar notificación',
};

const ACTION_TYPE_ICONS = {
  crear_tarea:        FiCalendar,
  reprogramar_tarea:  FiClock,
  reasignar_tarea:    FiCalendar,
  ajustar_inventario: FiPackage,
  enviar_notificacion:FiSend,
};

const STATUS_LABELS = {
  proposed: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  executed: 'Ejecutada',
  failed:   'Fallida',
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

function ActionParamsSummary({ type, params }) {
  if (!params) return null;
  const items = [];
  switch (type) {
    case 'crear_tarea':
      items.push(`Tarea: "${params.nombre}"`);
      if (params.loteNombre) items.push(`Lote: ${params.loteNombre}`);
      if (params.responsableNombre) items.push(`Responsable: ${params.responsableNombre}`);
      if (params.fecha) items.push(`Fecha: ${params.fecha}`);
      break;
    case 'reprogramar_tarea':
      items.push(`Tarea: "${params.taskName}"`);
      if (params.oldDate) items.push(`Fecha actual: ${params.oldDate}`);
      items.push(`Nueva fecha: ${params.newDate}`);
      break;
    case 'reasignar_tarea':
      items.push(`Tarea: "${params.taskName}"`);
      if (params.oldUserName) items.push(`De: ${params.oldUserName}`);
      items.push(`A: ${params.newUserName}`);
      break;
    case 'ajustar_inventario':
      items.push(`Producto: ${params.productoNombre}`);
      items.push(`Stock: ${params.stockActual ?? '?'} → ${params.stockNuevo} ${params.unidad || ''}`);
      break;
    case 'enviar_notificacion':
      items.push(`A: ${params.userName}`);
      items.push(`Mensaje: "${params.mensaje}"`);
      break;
  }
  if (!items.length) return null;
  return (
    <ul className="ap-action-params">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}

function ActionCard({ action, onApprove, onReject, canApprove }) {
  const [confirming, setConfirming] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const TypeIcon = ACTION_TYPE_ICONS[action.type] || FiGrid;

  const handleApprove = async () => {
    setProcessing(true);
    await onApprove(action.id);
    setProcessing(false);
    setConfirming(null);
  };

  const handleReject = async () => {
    setProcessing(true);
    await onReject(action.id, rejectReason);
    setProcessing(false);
    setConfirming(null);
  };

  const isActionable = action.status === 'proposed' && canApprove;

  return (
    <div className={`ap-action-card ap-action-card--${action.status} ap-action-card--pri-${action.prioridad}`}>
      <div className="ap-action-card-header">
        <TypeIcon size={14} className="ap-action-type-icon" />
        <span className="ap-action-type-label">{ACTION_TYPE_LABELS[action.type] || action.type}</span>
        {action.autonomous && (
          <span className="ap-action-badge-auto"><FiCpu size={10} /> Auto</span>
        )}
        <span className={`ap-action-status ap-action-status--${action.status}`}>
          {STATUS_LABELS[action.status]}
        </span>
      </div>
      <div className="ap-action-card-body">
        <p className="ap-action-titulo">{action.titulo}</p>
        {action.descripcion && action.descripcion !== action.titulo && (
          <p className="ap-action-descripcion">{action.descripcion}</p>
        )}
        <ActionParamsSummary type={action.type} params={action.params} />
      </div>

      {/* Info de barandilla violada (nivel3 escaladas) */}
      {action.escalated && action.guardrailViolations?.length > 0 && (
        <div className="ap-action-guardrail-info">
          <FiAlertTriangle size={12} />
          <span>Escalada: {action.guardrailViolations.join('; ')}</span>
        </div>
      )}

      {/* Botones aprobar/rechazar */}
      {isActionable && !confirming && (
        <div className="ap-action-buttons">
          <button className="ap-action-btn ap-action-btn--approve" onClick={() => setConfirming('approve')}>
            <FiCheck size={13} /> Aprobar y Ejecutar
          </button>
          <button className="ap-action-btn ap-action-btn--reject" onClick={() => setConfirming('reject')}>
            <FiX size={13} /> Rechazar
          </button>
        </div>
      )}

      {/* Confirmación de aprobación */}
      {confirming === 'approve' && (
        <div className="ap-action-confirm">
          <p>Esta acción se ejecutará inmediatamente. ¿Continuar?</p>
          <div className="ap-action-confirm-buttons">
            <button className="ap-action-btn ap-action-btn--approve" onClick={handleApprove} disabled={processing}>
              {processing ? 'Ejecutando...' : 'Confirmar'}
            </button>
            <button className="ap-action-btn ap-action-btn--cancel" onClick={() => setConfirming(null)} disabled={processing}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Confirmación de rechazo */}
      {confirming === 'reject' && (
        <div className="ap-action-confirm">
          <input
            type="text"
            placeholder="Razón del rechazo (opcional)"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            className="ap-action-reject-input"
          />
          <div className="ap-action-confirm-buttons">
            <button className="ap-action-btn ap-action-btn--reject" onClick={handleReject} disabled={processing}>
              {processing ? 'Rechazando...' : 'Confirmar Rechazo'}
            </button>
            <button className="ap-action-btn ap-action-btn--cancel" onClick={() => setConfirming(null)} disabled={processing}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Resultado de ejecución */}
      {action.status === 'executed' && (
        <div className="ap-action-result ap-action-result--ok">Ejecutada correctamente</div>
      )}
      {action.status === 'failed' && action.executionResult?.error && (
        <div className="ap-action-result ap-action-result--error">Error: {action.executionResult.error}</div>
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
  const [proposedActions, setProposedActions] = useState([]);
  const [executedActions, setExecutedActions] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Carga inicial: config + última sesión
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

  // Cargar acciones propuestas cuando el modo es nivel2
  useEffect(() => {
    if (!config || (config.mode !== 'nivel2' && config.mode !== 'nivel3')) return;
    let cancelled = false;
    async function loadActions() {
      try {
        const res = await apiFetch('/api/autopilot/actions');
        if (!cancelled) {
          const data = await res.json();
          setProposedActions(Array.isArray(data) ? data : []);
        }
      } catch (_) { /* silent */ }
    }
    loadActions();
    return () => { cancelled = true; };
  }, [config?.mode]);

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
        summaryText: data.summaryText || '',
        status: 'completed',
      });
      if (Array.isArray(data.proposedActions)) {
        setProposedActions(data.proposedActions);
      }
      if (Array.isArray(data.executedActions) || Array.isArray(data.failedActions)) {
        setExecutedActions([...(data.executedActions || []), ...(data.failedActions || [])]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApprove = async (actionId) => {
    try {
      const res = await apiFetch(`/api/autopilot/actions/${actionId}/approve`, { method: 'PUT' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setProposedActions(prev =>
        prev.map(a => a.id === actionId ? { ...a, status: data.status, executionResult: data.executionResult } : a)
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const handleReject = async (actionId, reason) => {
    try {
      const res = await apiFetch(`/api/autopilot/actions/${actionId}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setProposedActions(prev =>
        prev.map(a => a.id === actionId ? { ...a, status: 'rejected' } : a)
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const mode = config?.mode || 'off';
  const canConfig = hasMinRole(currentUser?.rol, 'supervisor');

  const recommendations = latestSession?.recommendations || [];
  const byPriority = (p) => recommendations.filter(r => r.prioridad === p);
  const actionsByPriority = (p) => proposedActions.filter(a => a.prioridad === p);
  const pendingCount = proposedActions.filter(a => a.status === 'proposed').length;

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

      {/* ── Resumen IA (nivel2/nivel3) ── */}
      {(mode === 'nivel2' || mode === 'nivel3') && latestSession?.summaryText && (
        <div className="ap-summary-box">
          <FiCpu size={13} className="ap-summary-icon" />
          <p>{latestSession.summaryText}</p>
        </div>
      )}

      {/* ── Recomendaciones agrupadas por prioridad (nivel1) ── */}
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

      {/* ── Acciones Propuestas (nivel2) ── */}
      {mode === 'nivel2' && proposedActions.length > 0 && (
        <div className="ap-actions-section">
          <h2 className="ap-actions-title">
            <FiZap size={14} /> Acciones Propuestas
            {pendingCount > 0 && (
              <span className="ap-actions-count">{pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}</span>
            )}
          </h2>
          {['alta', 'media', 'baja'].map(prioridad => {
            const group = actionsByPriority(prioridad);
            if (!group.length) return null;
            const PrioIcon = PRIORIDAD_ICONS[prioridad];
            return (
              <div key={prioridad} className="ap-action-group">
                <h3 className={`ap-rec-group-title ap-rec-group-title--${prioridad}`}>
                  <PrioIcon size={13} />
                  Prioridad {prioridad.charAt(0).toUpperCase() + prioridad.slice(1)}
                </h3>
                {group.map(action => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    canApprove={canConfig}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Nivel 3: Acciones Ejecutadas ── */}
      {mode === 'nivel3' && executedActions.length > 0 && (
        <div className="ap-actions-section">
          <h2 className="ap-actions-title ap-actions-title--n3">
            <FiZap size={14} /> Acciones Ejecutadas
            <span className="ap-actions-count ap-actions-count--executed">
              {executedActions.filter(a => a.status === 'executed').length} ejecutada{executedActions.filter(a => a.status === 'executed').length !== 1 ? 's' : ''}
            </span>
          </h2>
          {executedActions.map(action => (
            <ActionCard
              key={action.id}
              action={action}
              onApprove={handleApprove}
              onReject={handleReject}
              canApprove={false}
            />
          ))}
        </div>
      )}

      {/* ── Nivel 3: Acciones Escaladas ── */}
      {mode === 'nivel3' && proposedActions.length > 0 && (
        <div className="ap-actions-section">
          <h2 className="ap-actions-title ap-actions-title--escalated">
            <FiAlertTriangle size={14} /> Acciones Escaladas
            <span className="ap-actions-count">
              {proposedActions.filter(a => a.status === 'proposed').length} pendiente{proposedActions.filter(a => a.status === 'proposed').length !== 1 ? 's' : ''}
            </span>
          </h2>
          {proposedActions.map(action => (
            <ActionCard
              key={action.id}
              action={action}
              onApprove={handleApprove}
              onReject={handleReject}
              canApprove={canConfig}
            />
          ))}
        </div>
      )}

    </div>
  );
}
