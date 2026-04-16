import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  FiZap, FiRefreshCw, FiAlertTriangle, FiAlertCircle, FiInfo,
  FiPackage, FiCalendar, FiDroplet, FiActivity, FiGrid, FiClock, FiCpu,
  FiCheck, FiX, FiSend, FiThumbsUp, FiThumbsDown, FiTrash2, FiPlus,
  FiChevronDown, FiChevronUp, FiSliders, FiShoppingCart, FiFileText,
  FiMic, FiMicOff, FiMessageSquare,
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
  crear_tarea:            'Crear tarea',
  reprogramar_tarea:      'Reprogramar tarea',
  reasignar_tarea:        'Reasignar tarea',
  ajustar_inventario:     'Corregir inventario',
  enviar_notificacion:    'Enviar notificación',
  crear_solicitud_compra: 'Solicitud de compra',
  crear_orden_compra:     'Orden de compra',
};

const ACTION_TYPE_ICONS = {
  crear_tarea:            FiCalendar,
  reprogramar_tarea:      FiClock,
  reasignar_tarea:        FiCalendar,
  ajustar_inventario:     FiPackage,
  enviar_notificacion:    FiSend,
  crear_solicitud_compra: FiFileText,
  crear_orden_compra:     FiShoppingCart,
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
        className={`ap-fb-btn ${activeSignal === 'up' ? 'ap-fb-btn--active-up' : ''}`}
        onClick={e => handleClick('up', e)}
        disabled={saving}
        title="Útil"
      >
        <FiThumbsUp size={12} />
      </button>
      <button
        type="button"
        className={`ap-fb-btn ${activeSignal === 'down' ? 'ap-fb-btn--active-down' : ''}`}
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
          className="ap-fb-comment-toggle"
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
            className="ap-fb-comment-input"
            onClick={e => e.stopPropagation()}
          />
          <button
            type="button"
            className="ap-fb-comment-save"
            onClick={handleCommentSave}
            disabled={saving}
          >
            Guardar
          </button>
          <button
            type="button"
            className="ap-fb-comment-cancel"
            onClick={e => { e.stopPropagation(); setShowCommentFor(null); setComment(current?.comment || ''); }}
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

function ActionCard({ action, onApprove, onReject, canApprove, feedback, onFeedback }) {
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

function DirectivesPanel({ directives, onAdd, onDelete, saving }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');

  const handleAdd = async () => {
    const text = draft.trim();
    if (!text) return;
    await onAdd(text);
    setDraft('');
  };

  return (
    <div className="ap-directives">
      <button
        type="button"
        className="ap-directives-toggle"
        onClick={() => setExpanded(e => !e)}
      >
        <FiSliders size={13} />
        <span>Mis preferencias</span>
        <span className="ap-directives-count">{directives.length}</span>
        {expanded ? <FiChevronUp size={13} /> : <FiChevronDown size={13} />}
      </button>
      {expanded && (
        <div className="ap-directives-body">
          <p className="ap-directives-help">
            Reglas firmes que Copilot respetará siempre. Úsalas solo para lo que quieres que deje de hacer — los 👎 por sí solos no generan reglas.
          </p>
          <div className="ap-directives-add">
            <input
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              placeholder='Ej: "No recomendar compras si stockMinimo no está configurado"'
              maxLength={300}
              className="ap-directives-input"
            />
            <button
              type="button"
              className="ap-directives-add-btn"
              onClick={handleAdd}
              disabled={saving || !draft.trim()}
            >
              <FiPlus size={12} /> Añadir
            </button>
          </div>
          {directives.length === 0 ? (
            <p className="ap-directives-empty">Aún no tienes preferencias guardadas.</p>
          ) : (
            <ul className="ap-directives-list">
              {directives.map(d => (
                <li key={d.id} className="ap-directives-item">
                  <span className="ap-directives-text">{d.text}</span>
                  <button
                    type="button"
                    className="ap-directives-del"
                    onClick={() => onDelete(d.id)}
                    title="Eliminar"
                    disabled={saving}
                  >
                    <FiTrash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Web Speech API — graceful fallback if not supported (Safari iOS < 14.5, Firefox)
const SpeechRecognitionImpl =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

function CommandPanel({ onSubmit, sending, lastResponse }) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState(null);
  const recognitionRef = useRef(null);

  const voiceSupported = !!SpeechRecognitionImpl;

  useEffect(() => {
    if (!voiceSupported) return;
    const rec = new SpeechRecognitionImpl();
    rec.lang = 'es-CR';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ');
      setText(prev => (prev ? prev + ' ' : '') + transcript);
    };
    rec.onerror = (e) => {
      setMicError(e.error === 'not-allowed' ? 'Permiso de micrófono denegado.' : `Error de voz: ${e.error}`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    return () => {
      try { rec.abort(); } catch (_) { /* noop */ }
    };
  }, [voiceSupported]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    setMicError(null);
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setListening(true);
      } catch (err) {
        setMicError(err.message || 'No se pudo iniciar el reconocimiento de voz.');
      }
    }
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const result = await onSubmit(trimmed);
    if (result?.ok) setText('');
  };

  return (
    <div className="ap-command">
      <button
        type="button"
        className="ap-command-toggle"
        onClick={() => setExpanded(e => !e)}
      >
        <FiMessageSquare size={13} />
        <span>Comando / Instrucción</span>
        {expanded ? <FiChevronUp size={13} /> : <FiChevronDown size={13} />}
      </button>
      {expanded && (
        <div className="ap-command-body">
          <p className="ap-command-help">
            Dale una instrucción concreta al Piloto Automático. Ej: <i>"Genera una orden de compra de 20 kg de Mancozeb a Almacenes El Éxito"</i> o <i>"Notifícale a María que la tarea del lote Norte se reprograma para el viernes"</i>. Todas las acciones quedan como <strong>propuestas</strong> para aprobación.
          </p>
          <div className="ap-command-input-row">
            <textarea
              className="ap-command-textarea"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={voiceSupported
                ? 'Escribe o pulsa el micrófono para dictar…'
                : 'Escribe tu instrucción…'}
              rows={3}
              maxLength={2000}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
              }}
            />
            <div className="ap-command-buttons">
              {voiceSupported && (
                <button
                  type="button"
                  className={`ap-command-mic ${listening ? 'ap-command-mic--on' : ''}`}
                  onClick={toggleListening}
                  disabled={sending}
                  title={listening ? 'Detener dictado' : 'Dictar por voz'}
                >
                  {listening ? <FiMicOff size={14} /> : <FiMic size={14} />}
                </button>
              )}
              <button
                type="button"
                className="ap-command-send"
                onClick={handleSend}
                disabled={sending || !text.trim()}
              >
                <FiSend size={13} />
                {sending ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </div>
          {micError && (
            <div className="ap-command-mic-error">
              <FiAlertTriangle size={11} /> {micError}
            </div>
          )}
          {lastResponse?.clarifyingQuestion && (
            <div className="ap-command-clarify">
              <FiInfo size={13} className="ap-command-clarify-icon" />
              <div>
                <p className="ap-command-clarify-label">Aurora pregunta:</p>
                <p className="ap-command-clarify-text">{lastResponse.clarifyingQuestion}</p>
              </div>
            </div>
          )}
          {lastResponse?.summaryText && !lastResponse?.clarifyingQuestion && (
            <div className="ap-command-summary">
              <FiCheck size={12} className="ap-command-summary-icon" />
              <p>{lastResponse.summaryText}</p>
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
  const [proposedActions, setProposedActions] = useState([]);
  const [executedActions, setExecutedActions] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedbackMap, setFeedbackMap] = useState({});
  const [directives, setDirectives] = useState([]);
  const [directiveSaving, setDirectiveSaving] = useState(false);
  const [commandSending, setCommandSending] = useState(false);
  const [commandResponse, setCommandResponse] = useState(null);

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

  // Cargar directivas del usuario
  useEffect(() => {
    let cancelled = false;
    async function loadDirectives() {
      try {
        const res = await apiFetch('/api/autopilot/directives');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setDirectives(Array.isArray(data) ? data : []);
        }
      } catch (_) { /* silent */ }
    }
    loadDirectives();
    return () => { cancelled = true; };
  }, []);

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

  const handleSendCommand = async (text) => {
    setCommandSending(true);
    setError(null);
    try {
      const res = await apiFetch('/api/autopilot/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al procesar el comando.');
      setCommandResponse({
        summaryText: data.summaryText || '',
        clarifyingQuestion: data.clarifyingQuestion || null,
        actionsCount: Array.isArray(data.proposedActions) ? data.proposedActions.length : 0,
      });
      if (Array.isArray(data.proposedActions) && data.proposedActions.length > 0) {
        setProposedActions(prev => [...data.proposedActions, ...prev]);
      }
      return { ok: true };
    } catch (err) {
      setError(err.message);
      return { ok: false };
    } finally {
      setCommandSending(false);
    }
  };

  const handleAddDirective = async (text) => {
    setDirectiveSaving(true);
    try {
      const res = await apiFetch('/api/autopilot/directives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'No se pudo guardar la preferencia.');
      setDirectives(prev => [data, ...prev]);
    } catch (err) {
      setError(err.message);
    } finally {
      setDirectiveSaving(false);
    }
  };

  const handleDeleteDirective = async (id) => {
    setDirectiveSaving(true);
    try {
      const res = await apiFetch(`/api/autopilot/directives/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('No se pudo eliminar la preferencia.');
      setDirectives(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      setError(err.message);
    } finally {
      setDirectiveSaving(false);
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

      {/* ── Mis preferencias (directivas explícitas) ── */}
      {!loading && mode !== 'off' && (
        <DirectivesPanel
          directives={directives}
          onAdd={handleAddDirective}
          onDelete={handleDeleteDirective}
          saving={directiveSaving}
        />
      )}

      {/* ── Comando / Instrucción (texto + voz) ── */}
      {!loading && mode !== 'off' && (
        <CommandPanel
          onSubmit={handleSendCommand}
          sending={commandSending}
          lastResponse={commandResponse}
        />
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
                    feedback={feedbackMap[action.id]}
                    onFeedback={handleFeedback}
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
              feedback={feedbackMap[action.id]}
              onFeedback={handleFeedback}
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
              feedback={feedbackMap[action.id]}
              onFeedback={handleFeedback}
            />
          ))}
        </div>
      )}

    </div>
  );
}
