import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FiZap, FiRefreshCw, FiAlertTriangle, FiAlertCircle, FiInfo,
  FiPackage, FiCalendar, FiDroplet, FiActivity, FiGrid, FiClock, FiCpu,
  FiCheck, FiX, FiSend, FiThumbsUp, FiThumbsDown,
  FiChevronDown, FiChevronUp, FiShoppingCart, FiFileText,
  FiRotateCcw, FiUsers, FiSettings,
} from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import AutopilotHealthPanel from '../components/AutopilotHealthPanel';
import { translateApiError } from '../../../lib/errorMessages';
import '../styles/autopilot-dashboard.css';

// ── Constantes ────────────────────────────────────────────────────────────────

const MODE_LABELS = {
  off:    'Desactivado',
  nivel1: 'Nivel 1 — Recomendaciones',
  nivel2: 'Nivel 2 — Agencia Supervisada',
  nivel3: 'Nivel 3 — Agencia Total',
};

// Mapping mode → aur-badge variant. Cada nivel toma el color significativo
// del sistema (gray/blue/yellow/magenta) coherente con el slider.
const MODE_BADGE_VARIANT = {
  off:    'gray',
  nivel1: 'blue',
  nivel2: 'yellow',
  nivel3: 'magenta',
};

const CATEGORIA_ICONS = {
  inventario:   FiPackage,
  tareas:       FiCalendar,
  aplicaciones: FiDroplet,
  monitoreo:    FiActivity,
  general:      FiGrid,
  procurement:  FiShoppingCart,
  hr:           FiUsers,
};

const CATEGORIA_LABELS = {
  inventario:   'Inventario',
  tareas:       'Tareas',
  aplicaciones: 'Aplicaciones',
  monitoreo:    'Monitoreo',
  general:      'General',
  procurement:  'Abastecimiento',
  hr:           'RR.HH.',
  financiera:   'Finanzas',
  meta:         'Meta',
};

const PRIORIDAD_ICONS = {
  alta:  FiAlertTriangle,
  media: FiAlertCircle,
  baja:  FiInfo,
};

const ACTION_TYPE_LABELS = {
  crear_tarea:            'Crear tarea',
  reprogramar_tarea:      'Reprogramar tarea',
  reasignar_tarea:        'Reasignar tarea',
  ajustar_inventario:     'Corregir inventario',
  enviar_notificacion:    'Enviar notificación',
  crear_solicitud_compra: 'Solicitud de compra',
  crear_orden_compra:     'Orden de compra',
  reasignar_presupuesto:  'Reasignar presupuesto',
  crear_siembra:          'Crear siembra',
  ajustar_guardrails:     'Ajustar guardrails',
};

const ACTION_TYPE_ICONS = {
  crear_tarea:            FiCalendar,
  reprogramar_tarea:      FiClock,
  reasignar_tarea:        FiCalendar,
  ajustar_inventario:     FiPackage,
  enviar_notificacion:    FiSend,
  crear_solicitud_compra: FiFileText,
  crear_orden_compra:     FiShoppingCart,
  reasignar_presupuesto:  FiFileText,
  crear_siembra:          FiCalendar,
  ajustar_guardrails:     FiFileText,
};

const STATUS_LABELS = {
  proposed: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  executed: 'Ejecutada',
  failed:   'Fallida',
};

const STATUS_BADGE_VARIANT = {
  proposed: 'yellow',
  approved: 'green',
  executed: 'green',
  rejected: 'gray',
  failed:   'magenta',
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

function FeedbackControls({ current, onSubmit }) {
  const [showCommentFor, setShowCommentFor] = useState(null);
  const [comment, setComment] = useState(current?.comment || '');
  const [saving, setSaving] = useState(false);

  const activeSignal = current?.signal || null;

  const handleClick = async (signal, e) => {
    e.stopPropagation();
    if (activeSignal === signal) {
      setSaving(true);
      await onSubmit(null, '');
      setSaving(false);
      setShowCommentFor(null);
      setComment('');
      return;
    }
    setSaving(true);
    await onSubmit(signal, comment || current?.comment || '');
    setSaving(false);
    if (signal === 'down') {
      setShowCommentFor('down');
      setComment(current?.comment || '');
    } else {
      setShowCommentFor(null);
    }
  };

  const handleCommentSave = async (e) => {
    e.stopPropagation();
    setSaving(true);
    await onSubmit(activeSignal, comment);
    setSaving(false);
    setShowCommentFor(null);
  };

  return (
    <div className="ap-feedback" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className={`aur-icon-btn aur-icon-btn--sm ap-fb-btn${activeSignal === 'up' ? ' ap-fb-btn--active-up' : ''}`}
        onClick={e => handleClick('up', e)}
        disabled={saving}
        title="Útil"
      >
        <FiThumbsUp size={12} />
      </button>
      <button
        type="button"
        className={`aur-icon-btn aur-icon-btn--sm ap-fb-btn${activeSignal === 'down' ? ' ap-fb-btn--active-down' : ''}`}
        onClick={e => handleClick('down', e)}
        disabled={saving}
        title="No útil"
      >
        <FiThumbsDown size={12} />
      </button>
      {activeSignal === 'down' && showCommentFor !== 'down' && current?.comment && (
        <span className="ap-fb-comment-preview" title={current.comment}>
          "{current.comment.slice(0, 40)}{current.comment.length > 40 ? '…' : ''}"
        </span>
      )}
      {activeSignal === 'down' && showCommentFor !== 'down' && (
        <button
          type="button"
          className="aur-btn-text ap-fb-comment-toggle"
          onClick={e => { e.stopPropagation(); setShowCommentFor('down'); setComment(current?.comment || ''); }}
        >
          {current?.comment ? 'Editar motivo' : 'Añadir motivo (opcional)'}
        </button>
      )}
      {showCommentFor === 'down' && (
        <div className="ap-fb-comment-box">
          <input
            type="text"
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="¿Qué no fue útil? (opcional)"
            maxLength={500}
            className="aur-input ap-fb-comment-input"
            onClick={e => e.stopPropagation()}
          />
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={handleCommentSave}
            disabled={saving}
          >
            Guardar
          </button>
          <button
            type="button"
            className="aur-icon-btn aur-icon-btn--sm"
            onClick={e => { e.stopPropagation(); setShowCommentFor(null); setComment(current?.comment || ''); }}
            title="Cancelar"
          >
            <FiX size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

function RecommendationCard({ rec, feedback, onFeedback }) {
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
          {onFeedback && (
            <FeedbackControls
              current={feedback}
              onSubmit={(signal, comment) => onFeedback(rec, 'recommendation', signal, comment)}
            />
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
    case 'crear_solicitud_compra': {
      const list = Array.isArray(params.items) ? params.items : [];
      items.push(`${list.length} producto${list.length !== 1 ? 's' : ''}`);
      list.slice(0, 5).forEach(p => {
        items.push(`• ${p.nombreComercial}: ${p.cantidadSolicitada} ${p.unidad}`);
      });
      if (list.length > 5) items.push(`…y ${list.length - 5} más`);
      if (params.responsableNombre) items.push(`Responsable: ${params.responsableNombre}`);
      break;
    }
    case 'crear_orden_compra': {
      const list = Array.isArray(params.items) ? params.items : [];
      items.push(`Proveedor: ${params.proveedor || '—'}`);
      items.push(`${list.length} producto${list.length !== 1 ? 's' : ''}`);
      list.slice(0, 5).forEach(p => {
        const precio = (p.precioUnitario || 0) > 0 ? ` @ ${p.precioUnitario} ${p.moneda || 'USD'}` : '';
        items.push(`• ${p.nombreComercial}: ${p.cantidad} ${p.unidad}${precio}`);
      });
      if (list.length > 5) items.push(`…y ${list.length - 5} más`);
      if (params.fechaEntrega) items.push(`Entrega: ${params.fechaEntrega}`);
      break;
    }
  }
  if (!items.length) return null;
  return (
    <ul className="ap-action-params">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}

// Returns null if the action can be acted on at the current level, or an
// object { requiredMode, requiredLabel } when it was originated at a higher
// level than current. 'command'-sourced actions are never level-locked
// (commands are explicit user requests). Legacy actions without sourceMode
// also pass through unlocked for backwards compat.
const LEVEL_RANK = { off: 0, nivel1: 1, nivel2: 2, nivel3: 3 };
const LEVEL_LABELS = { nivel1: 'Nivel 1', nivel2: 'Nivel 2', nivel3: 'Nivel 3' };
function getActionLevelLock(sourceMode, currentMode) {
  if (!sourceMode || sourceMode === 'command') return null;
  const sourceRank = LEVEL_RANK[sourceMode] ?? 0;
  const currentRank = LEVEL_RANK[currentMode] ?? 0;
  if (sourceRank <= currentRank) return null;
  return { requiredMode: sourceMode, requiredLabel: LEVEL_LABELS[sourceMode] || sourceMode };
}

function ActionCard({ action, onApprove, onReject, onRollback, canApprove, canRollback, canSeeReasoning, feedback, onFeedback, levelLock }) {
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

  const handleRollback = async () => {
    setProcessing(true);
    await onRollback(action.id);
    setProcessing(false);
    setConfirming(null);
  };

  const isActionable = action.status === 'proposed' && canApprove;
  const canBeRolledBack = action.status === 'executed' && !action.rolledBack && canRollback && !!onRollback;
  const statusVariant = STATUS_BADGE_VARIANT[action.status] || 'gray';

  return (
    <div className={`ap-action-card ap-action-card--${action.status} ap-action-card--pri-${action.prioridad}`}>
      <div className="ap-action-card-header">
        <TypeIcon size={14} className="ap-action-type-icon" />
        <span className="ap-action-type-label">{ACTION_TYPE_LABELS[action.type] || action.type}</span>
        {action.autonomous && (
          <span className="aur-badge aur-badge--violet ap-action-badge-auto"><FiCpu size={10} /> Auto</span>
        )}
        <span className={`aur-badge aur-badge--${statusVariant} ap-action-status`}>
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

      {/* Botones aprobar/rechazar (o aviso de nivel insuficiente) */}
      {isActionable && !confirming && !levelLock && (
        <div className="ap-action-buttons">
          <button className="aur-btn-pill aur-btn-pill--sm" onClick={() => setConfirming('approve')}>
            <FiCheck size={13} /> Aprobar y Ejecutar
          </button>
          <button className="aur-btn-pill aur-btn-pill--sm aur-btn-pill--danger" onClick={() => setConfirming('reject')}>
            <FiX size={13} /> Rechazar
          </button>
        </div>
      )}
      {isActionable && !confirming && levelLock && (
        <div className="ap-action-locked">
          <div className="ap-action-buttons">
            <button className="aur-btn-pill aur-btn-pill--sm" disabled>
              <FiCheck size={13} /> Aprobar y Ejecutar
            </button>
            <button className="aur-btn-pill aur-btn-pill--sm aur-btn-pill--danger" disabled>
              <FiX size={13} /> Rechazar
            </button>
          </div>
          <p className="ap-action-locked-notice">
            <FiInfo size={12} /> Activa <strong>{levelLock.requiredLabel}</strong> para poder aprobar o rechazar esta propuesta.
          </p>
        </div>
      )}

      {/* Confirmación de aprobación */}
      {confirming === 'approve' && (
        <div className="ap-action-confirm">
          <p>Esta acción se ejecutará inmediatamente. ¿Continuar?</p>
          <div className="ap-action-confirm-buttons">
            <button className="aur-btn-pill aur-btn-pill--sm" onClick={handleApprove} disabled={processing}>
              {processing ? 'Ejecutando…' : 'Confirmar'}
            </button>
            <button className="aur-btn-text" onClick={() => setConfirming(null)} disabled={processing}>
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
            className="aur-input ap-action-reject-input"
          />
          <div className="ap-action-confirm-buttons">
            <button className="aur-btn-pill aur-btn-pill--sm aur-btn-pill--danger" onClick={handleReject} disabled={processing}>
              {processing ? 'Rechazando…' : 'Confirmar Rechazo'}
            </button>
            <button className="aur-btn-text" onClick={() => setConfirming(null)} disabled={processing}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Resultado de ejecución */}
      {action.status === 'executed' && (
        <div className="ap-action-result ap-action-result--ok">
          {action.rolledBack ? 'Revertida' : 'Ejecutada correctamente'}
        </div>
      )}
      {action.status === 'failed' && action.executionResult?.error && (
        <div className="ap-action-result ap-action-result--error">Error: {action.executionResult.error}</div>
      )}

      {/* Botón Revertir */}
      {canBeRolledBack && !confirming && (
        <div className="ap-action-buttons">
          <button className="aur-btn-pill aur-btn-pill--sm ap-action-btn--rollback" onClick={() => setConfirming('rollback')}>
            <FiRotateCcw size={13} /> Revertir
          </button>
        </div>
      )}

      {/* Confirmación de reversión */}
      {confirming === 'rollback' && (
        <div className="ap-action-confirm">
          <p>Esto deshará el efecto de la acción. ¿Continuar?</p>
          <div className="ap-action-confirm-buttons">
            <button className="aur-btn-pill aur-btn-pill--sm ap-action-btn--rollback" onClick={handleRollback} disabled={processing}>
              {processing ? 'Revirtiendo…' : 'Confirmar reversión'}
            </button>
            <button className="aur-btn-text" onClick={() => setConfirming(null)} disabled={processing}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Razonamiento de Claude — supervisor+ */}
      {canSeeReasoning && <ReasoningPanel actionId={action.id} />}

      {/* Feedback — siempre visible al final */}
      {onFeedback && (
        <FeedbackControls
          current={feedback}
          onSubmit={(signal, comment) => onFeedback(action, 'action', signal, comment)}
        />
      )}
    </div>
  );
}

function ReasoningPanel({ actionId }) {
  const apiFetch = useApiFetch();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleToggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (data || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/autopilot/actions/${actionId}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(translateApiError(body));
      setData(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reasoning = data?.reasoning;

  return (
    <div className="ap-action-reasoning">
      <button type="button" className="aur-btn-text ap-action-reasoning-toggle" onClick={handleToggle}>
        {open ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />}
        {open ? 'Ocultar razonamiento' : 'Ver razonamiento del modelo'}
      </button>
      {open && (
        <div className="ap-action-reasoning-body">
          {loading && <p className="ap-action-reasoning-empty">Cargando…</p>}
          {error && <p className="ap-action-reasoning-error">{error}</p>}
          {!loading && !error && data && !reasoning && (
            <p className="ap-action-reasoning-empty">Esta acción no tiene razonamiento registrado.</p>
          )}
          {reasoning && (
            <>
              {reasoning.thinking ? (
                <pre className="ap-action-reasoning-thinking">{reasoning.thinking}</pre>
              ) : (
                <p className="ap-action-reasoning-empty">Sin texto de razonamiento (el modelo no lo emitió).</p>
              )}
              <div className="ap-action-reasoning-meta">
                {reasoning.modelVersion && <span>Modelo: {reasoning.modelVersion}</span>}
                {reasoning.toolName && <span>Herramienta: {reasoning.toolName}</span>}
                {reasoning.capturedAt && <span>{new Date(reasoning.capturedAt).toLocaleString('es-ES')}</span>}
              </div>
            </>
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
  const [proposedActions, setProposedActions] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [executedActions, setExecutedActions] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedbackMap, setFeedbackMap] = useState({});

  // Initial load: config + latest session
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
        if (!cancelled) setError('No se pudo cargar la información de Aurora Copilot.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Refresca cuando cambia el estado de Aurora Copilot desde el modal del header
  // (nivel, pausa/reanudación, nuevas acciones propuestas).
  useEffect(() => {
    const handler = () => setReloadKey(k => k + 1);
    window.addEventListener('aurora-autopilot-changed', handler);
    return () => window.removeEventListener('aurora-autopilot-changed', handler);
  }, []);

  // Cargar acciones propuestas. Antes solo se cargaba en N2/N3, lo que hacía
  // que al cambiar de nivel las acciones desaparecieran de la UI aunque
  // siguieran existiendo en la DB. Ahora se cargan siempre y la UI marca
  // como "bloqueadas" las que requieren un nivel superior al actual.
  useEffect(() => {
    if (!config) return;
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

  // Load feedback for the current session (recommendations + actions)
  useEffect(() => {
    const sid = latestSession?.id;
    if (!sid) return;
    let cancelled = false;
    async function loadFeedback() {
      try {
        const res = await apiFetch(`/api/autopilot/feedback?sessionId=${encodeURIComponent(sid)}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          const map = {};
          (Array.isArray(data) ? data : []).forEach(f => {
            map[f.targetId] = { signal: f.signal, comment: f.comment || '' };
          });
          setFeedbackMap(map);
        }
      } catch (_) { /* silent */ }
    }
    loadFeedback();
    return () => { cancelled = true; };
  }, [latestSession?.id]);

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

  const handleRollback = async (actionId) => {
    try {
      const res = await apiFetch(`/api/autopilot/actions/${actionId}/rollback`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(translateApiError(data));
      setExecutedActions(prev =>
        prev.map(a => a.id === actionId ? { ...a, rolledBack: true } : a)
      );
      setProposedActions(prev =>
        prev.map(a => a.id === actionId ? { ...a, rolledBack: true } : a)
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFeedback = async (target, targetType, signal, comment) => {
    const sid = latestSession?.id;
    if (!sid) return;
    const targetId = target.id;
    const titulo = target.titulo || target.titulo || target.nombre || '';
    try {
      if (signal === null) {
        const res = await apiFetch(`/api/autopilot/feedback?sessionId=${encodeURIComponent(sid)}&targetId=${encodeURIComponent(targetId)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('No se pudo borrar el feedback.');
        setFeedbackMap(prev => {
          const next = { ...prev };
          delete next[targetId];
          return next;
        });
        return;
      }
      const res = await apiFetch('/api/autopilot/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          targetId,
          targetType,
          targetTitle: titulo,
          categoria: target.categoria || 'general',
          nivel: config?.mode || null,
          signal,
          comment: comment || '',
        }),
      });
      if (!res.ok) throw new Error('No se pudo guardar el feedback.');
      setFeedbackMap(prev => ({ ...prev, [targetId]: { signal, comment: comment || '' } }));
    } catch (err) {
      setError(err.message);
    }
  };

  const mode = config?.mode || 'off';
  const canConfig = hasMinRole(currentUser?.rol, 'supervisor');
  const modeBadgeVariant = MODE_BADGE_VARIANT[mode] || 'gray';

  const recommendations = latestSession?.recommendations || [];
  const byPriority = (p) => recommendations.filter(r => r.prioridad === p);
  const actionsByPriority = (p) => proposedActions.filter(a => a.prioridad === p);
  const pendingCount = proposedActions.filter(a => a.status === 'proposed').length;

  return (
    <div className="ap-page">

      {/* ── Header ── */}
      <div className="ap-header">
        <div className="ap-header-left">
          <h1 className="ap-title"><FiCpu size={18} /> Aurora Copilot</h1>
          <span className={`aur-badge aur-badge--${modeBadgeVariant} ap-mode-badge`}>
            {MODE_LABELS[mode] || mode}
          </span>
          {!loading && mode === 'off' && (
            <span className="ap-header-off-hint">
              {canConfig
                ? 'Actívalo desde el slider del menú Copilot.'
                : 'Pídele a un supervisor que lo active.'}
            </span>
          )}
        </div>
        <div className="ap-header-right">
          {latestSession?.timestamp && (
            <span className="ap-last-run">
              <FiClock size={12} />
              {formatTimestamp(latestSession.timestamp)}
            </span>
          )}
          <button
            className="aur-btn-pill aur-btn-pill--sm ap-analyze-btn"
            onClick={handleAnalyze}
            disabled={analyzing || mode === 'off' || loading}
          >
            <FiRefreshCw size={14} className={analyzing ? 'ap-spin' : ''} />
            {analyzing ? 'Analizando…' : 'Analizar Ahora'}
          </button>
          {canConfig && (
            <Link to="/autopilot/configuracion" className="aur-btn-text ap-config-link">
              <FiSettings size={13} /> Configurar
            </Link>
          )}
        </div>
      </div>

      {/* ── Panel de salud (supervisor+) ── */}
      {canConfig && <AutopilotHealthPanel />}

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
                {group.map(rec => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    feedback={feedbackMap[rec.id]}
                    onFeedback={handleFeedback}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Acciones Propuestas (todas las que no son escaladas N3) ── */}
      {proposedActions.filter(a => !a.escalated).length > 0 && (
        <div className="ap-actions-section">
          <h2 className="ap-actions-title">
            <FiZap size={14} /> Acciones Propuestas
            {pendingCount > 0 && (
              <span className="aur-badge aur-badge--yellow ap-actions-count">{pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}</span>
            )}
          </h2>
          {['alta', 'media', 'baja'].map(prioridad => {
            const group = actionsByPriority(prioridad).filter(a => !a.escalated);
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
                    canSeeReasoning={canConfig}
                    feedback={feedbackMap[action.id]}
                    onFeedback={handleFeedback}
                    levelLock={getActionLevelLock(action.sourceMode, mode)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Acciones Ejecutadas (N3) ── */}
      {executedActions.length > 0 && (
        <div className="ap-actions-section">
          <h2 className="ap-actions-title ap-actions-title--n3">
            <FiZap size={14} /> Acciones Ejecutadas
            <span className="aur-badge aur-badge--green ap-actions-count">
              {executedActions.filter(a => a.status === 'executed').length} ejecutada{executedActions.filter(a => a.status === 'executed').length !== 1 ? 's' : ''}
            </span>
          </h2>
          {executedActions.map(action => (
            <ActionCard
              key={action.id}
              action={action}
              onApprove={handleApprove}
              onReject={handleReject}
              onRollback={handleRollback}
              canApprove={false}
              canRollback={canConfig}
              canSeeReasoning={canConfig}
              feedback={feedbackMap[action.id]}
              onFeedback={handleFeedback}
            />
          ))}
        </div>
      )}

      {/* ── Acciones Escaladas (propuestas con escalated=true, típicamente N3) ── */}
      {proposedActions.filter(a => a.escalated).length > 0 && (
        <div className="ap-actions-section">
          <h2 className="ap-actions-title ap-actions-title--escalated">
            <FiAlertTriangle size={14} /> Acciones Escaladas
            <span className="aur-badge aur-badge--yellow ap-actions-count">
              {proposedActions.filter(a => a.status === 'proposed' && a.escalated).length} pendiente{proposedActions.filter(a => a.status === 'proposed' && a.escalated).length !== 1 ? 's' : ''}
            </span>
          </h2>
          {proposedActions.filter(a => a.escalated).map(action => (
            <ActionCard
              key={action.id}
              action={action}
              onApprove={handleApprove}
              onReject={handleReject}
              canApprove={canConfig}
              canSeeReasoning={canConfig}
              feedback={feedbackMap[action.id]}
              onFeedback={handleFeedback}
              levelLock={getActionLevelLock(action.sourceMode, mode)}
            />
          ))}
        </div>
      )}

    </div>
  );
}
