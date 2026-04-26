import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  FiCpu, FiRefreshCw, FiZap, FiAlertTriangle, FiInfo,
  FiSend, FiMic, FiMicOff, FiX, FiSliders, FiArrowRight, FiClock,
} from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import AutopilotLevelSlider from './AutopilotLevelSlider';
import AutopilotPauseButton from './AutopilotPauseButton';
import '../styles/autopilot-panel.css';

// Graceful fallback if Web Speech API unsupported
const SpeechRec = typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

// Helpers to mark actions as level-locked when their sourceMode is higher
// than the current finca mode. Duplicated here (rather than imported) to
// keep the modal self-contained — same logic lives in AutopilotDashboard.
const LEVEL_RANK = { off: 0, nivel1: 1, nivel2: 2, nivel3: 3 };
const LEVEL_LABELS = { nivel1: 'Nivel 1', nivel2: 'Nivel 2', nivel3: 'Nivel 3' };

// Mapping prioridad → aur-badge variant para los chips del feed compacto.
// alta=rojo (urgent), media=amarillo (atención), baja=azul (info), accion=magenta.
const PRIO_BADGE_VARIANT = {
  alta:  'magenta',
  media: 'yellow',
  baja:  'blue',
};
function getActionLevelLock(sourceMode, currentMode) {
  if (!sourceMode || sourceMode === 'command') return null;
  const sourceRank = LEVEL_RANK[sourceMode] ?? 0;
  const currentRank = LEVEL_RANK[currentMode] ?? 0;
  if (sourceRank <= currentRank) return null;
  return { requiredMode: sourceMode, requiredLabel: LEVEL_LABELS[sourceMode] || sourceMode };
}

function formatTimestamp(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-CR', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default function AutopilotPanel({ open, onClose }) {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const canConfig = hasMinRole(currentUser?.rol, 'supervisor');

  const [config, setConfig] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  // Latest analysis output: text recommendations (N1) and/or proposed
  // actions (N2/N3). Both render below the command panel as a "result of
  // last analysis" list, so the user sees evidence the analysis ran without
  // navigating to the dashboard.
  const [recommendations, setRecommendations] = useState([]);
  const [proposedActions, setProposedActions] = useState([]);
  // Dismissed IDs persist per user so "acting on" an item removes it from
  // the modal permanently (it stays available in the dashboard).
  const [dismissed, setDismissed] = useState(() => new Set());

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [conversation, setConversation] = useState([]);
  const [sessionId, setSessionId] = useState(null);

  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState(null);
  const recognitionRef = useRef(null);
  const chatEndRef = useRef(null);
  const voiceSupported = !!SpeechRec;

  // Hydrate dismissed-IDs from localStorage once the user is known.
  useEffect(() => {
    if (!currentUser?.uid) return;
    try {
      const raw = localStorage.getItem(`aurora_copilot_dismissed_${currentUser.uid}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setDismissed(new Set(parsed));
      }
    } catch { /* noop */ }
  }, [currentUser?.uid]);

  const dismiss = (id) => {
    if (!id) return;
    setDismissed(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      // Cap to 200 most-recent IDs so localStorage doesn't grow unbounded.
      const arr = Array.from(next);
      const capped = arr.length > 200 ? arr.slice(-200) : arr;
      try {
        if (currentUser?.uid) {
          localStorage.setItem(
            `aurora_copilot_dismissed_${currentUser.uid}`,
            JSON.stringify(capped),
          );
        }
      } catch { /* quota / private mode — best effort */ }
      return new Set(capped);
    });
  };

  // Refresh config + counts + latest analysis each time the panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [configRes, sessionsRes, actionsRes] = await Promise.all([
          apiFetch('/api/autopilot/config'),
          apiFetch('/api/autopilot/sessions'),
          apiFetch('/api/autopilot/actions'),
        ]);
        const [configData, sessionsData, actionsData] = await Promise.all([
          configRes.json().catch(() => ({})),
          sessionsRes.json().catch(() => []),
          actionsRes.json().catch(() => []),
        ]);
        if (cancelled) return;
        setConfig(configData);
        if (Array.isArray(sessionsData) && sessionsData.length > 0) {
          setLastRun(sessionsData[0].timestamp);
          // Pull the latest session in full only if it actually has recs to render.
          const head = sessionsData[0];
          if (head?.id && (head.recommendationsCount || 0) > 0) {
            const sessionRes = await apiFetch(`/api/autopilot/sessions/${head.id}`);
            if (!cancelled && sessionRes.ok) {
              const sessionData = await sessionRes.json().catch(() => null);
              if (sessionData && Array.isArray(sessionData.recommendations)) {
                setRecommendations(sessionData.recommendations);
              }
            }
          } else {
            setRecommendations([]);
          }
        } else {
          setRecommendations([]);
        }
        if (Array.isArray(actionsData)) {
          const proposed = actionsData.filter(a => a.status === 'proposed');
          setProposedActions(proposed);
        }
      } catch (_) { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [open, apiFetch]);

  // Autoscroll conversation log
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.length]);

  // Voice recognition setup (Web Speech API)
  useEffect(() => {
    if (!voiceSupported) return;
    const rec = new SpeechRec();
    rec.lang = 'es-CR';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ');
      setText(prev => (prev ? prev + ' ' : '') + transcript);
    };
    rec.onerror = (e) => {
      setMicError(e.error === 'not-allowed' ? 'Micrófono denegado.' : `Error: ${e.error}`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    return () => { try { rec.abort(); } catch (_) { /* noop */ } };
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

  // Core analyze call that throws on error. Used by both handleAnalyze (with
  // its own error UI) and the level slider's "Activar y analizar" flow, which
  // manages its own busy state.
  const runAnalyze = async () => {
    const res = await apiFetch('/api/autopilot/analyze', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Error al analizar');
    setLastRun(data.timestamp);
    // N1 returns `recommendations`; N2/N3 return `proposedActions`.
    if (Array.isArray(data.recommendations)) {
      setRecommendations(data.recommendations);
    }
    if (Array.isArray(data.proposedActions)) {
      const proposed = data.proposedActions.filter(a => a.status === 'proposed');
      setProposedActions(prev => [...proposed, ...prev]);
    }
    window.dispatchEvent(new CustomEvent('aurora-autopilot-changed'));
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      await runAnalyze();
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const payload = { text: trimmed };
      if (sessionId) payload.sessionId = sessionId;
      const res = await apiFetch('/api/autopilot/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al procesar.');
      setSessionId(data.sessionId);
      setConversation(Array.isArray(data.conversationLog) ? data.conversationLog : []);
      if (Array.isArray(data.proposedActions) && data.proposedActions.length > 0) {
        const proposed = data.proposedActions.filter(a => a.status === 'proposed');
        setProposedActions(prev => [...proposed, ...prev]);
        window.dispatchEvent(new CustomEvent('aurora-autopilot-changed'));
      }
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleReset = () => {
    setSessionId(null);
    setConversation([]);
  };

  const handleModeChange = async (nextMode) => {
    const res = await apiFetch('/api/autopilot/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: nextMode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || 'No se pudo actualizar el nivel.');
    }
    setConfig(prev => ({ ...(prev || {}), mode: nextMode }));
    window.dispatchEvent(new CustomEvent('aurora-autopilot-changed'));
  };

  const mode = config?.mode || 'off';

  return (
    <>
      {open && <div className="autopilot-panel-backdrop" onClick={onClose} />}
      <div className={`autopilot-panel${open ? ' open' : ''}`}>
        <div className="ap-panel-header">
          <div className="ap-panel-header-row">
            <div className="ap-panel-title">
              <FiCpu size={18} />
              <span>Aurora Copilot</span>
            </div>
            <div className="ap-panel-header-actions">
              <AutopilotPauseButton open={open} mode={mode} />
              {canConfig && (
                <Link
                  to="/autopilot/configuracion"
                  onClick={onClose}
                  className="aur-icon-btn aur-icon-btn--sm"
                  title="Configuración"
                  aria-label="Configuración"
                >
                  <FiSliders size={15} />
                </Link>
              )}
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--sm"
                onClick={onClose}
                title="Cerrar"
                aria-label="Cerrar"
              >
                <FiX size={18} />
              </button>
            </div>
          </div>
          {config && (
            <AutopilotLevelSlider
              mode={mode}
              disabled={!canConfig}
              onChange={handleModeChange}
              onAnalyze={runAnalyze}
              onNavigate={onClose}
              objectives={config.objectives}
            />
          )}
        </div>

        <div className="ap-panel-body">
          {mode === 'off' && canConfig && (
            <div className="ap-panel-notice ap-panel-notice--cta">
              <FiZap size={14} />
              <span>
                Aurora Copilot está apagado. Desliza el control de nivel de arriba para activarlo y elegir cuánta autonomía quieres darle.
              </span>
            </div>
          )}

          {mode === 'off' && !canConfig && (
            <div className="ap-panel-notice">
              <FiInfo size={14} />
              <span>Aurora Copilot está desactivado. Pídele a un supervisor que lo active.</span>
            </div>
          )}

          {error && (
            <div className="ap-panel-notice ap-panel-notice--error">
              <FiAlertTriangle size={14} /> {error}
            </div>
          )}

          {mode !== 'off' && (
            <>
              <div className="ap-panel-row">
                <span className="ap-panel-last-run">
                  <FiClock size={12} />
                  {lastRun ? `Último: ${formatTimestamp(lastRun)}` : 'Sin análisis aún'}
                </span>
                <button
                  type="button"
                  className="aur-btn-pill aur-btn-pill--sm"
                  onClick={handleAnalyze}
                  disabled={analyzing}
                >
                  <FiRefreshCw size={13} className={analyzing ? 'ap-panel-spin' : ''} />
                  {analyzing ? 'Analizando…' : 'Analizar ahora'}
                </button>
              </div>

              <div className="ap-panel-command">
                <label className="aur-field-label ap-panel-label" htmlFor="ap-panel-cmd-input">Comando / instrucción</label>
                <p className="ap-panel-command-help">
                  Dale una instrucción concreta a Aurora Copilot. Ej: <i>"Genera una orden de compra de 20 kg de Mancozeb a Almacenes El Éxito"</i> o <i>"Notifícale a María que la tarea del lote Norte se reprograma para el viernes"</i>. Todas las acciones quedan como <strong>propuestas</strong> para aprobación.
                </p>
                <textarea
                  id="ap-panel-cmd-input"
                  className="aur-textarea ap-panel-textarea"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={voiceSupported
                    ? 'Escribe o dicta una instrucción…'
                    : 'Escribe una instrucción…'}
                  rows={3}
                  maxLength={2000}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(); }}
                />
                <div className="ap-panel-command-buttons">
                  {voiceSupported && (
                    <button
                      type="button"
                      className={`aur-icon-btn aur-icon-btn--sm ap-panel-mic${listening ? ' ap-panel-mic--on' : ''}`}
                      onClick={toggleListening}
                      disabled={sending}
                      title={listening ? 'Detener dictado' : 'Dictar por voz'}
                    >
                      {listening ? <FiMicOff size={14} /> : <FiMic size={14} />}
                    </button>
                  )}
                  <button
                    type="button"
                    className="aur-btn-pill aur-btn-pill--sm"
                    onClick={handleSend}
                    disabled={sending || !text.trim()}
                  >
                    <FiSend size={13} />
                    {sending ? 'Enviando…' : 'Enviar'}
                  </button>
                </div>
                {micError && (
                  <div className="ap-panel-mic-error">
                    <FiAlertTriangle size={11} /> {micError}
                  </div>
                )}
              </div>

              {conversation.length > 0 && (
                <>
                  <div className="ap-panel-chat">
                    {conversation.map((entry, i) => (
                      <div key={i} className={`ap-panel-bubble ap-panel-bubble--${entry.role}`}>
                        <span className="ap-panel-role">
                          {entry.role === 'user' ? 'Tú' : 'Aurora'}
                        </span>
                        <p>{entry.content}</p>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <button
                    type="button"
                    className="aur-btn-text ap-panel-reset"
                    onClick={handleReset}
                    disabled={sending}
                  >
                    Nueva conversación
                  </button>
                </>
              )}

              {(() => {
                const visibleRecs = recommendations
                  .filter(r => r && !dismissed.has(r.id))
                  .slice(0, 5);
                const visibleActions = proposedActions
                  .filter(a => a && a.status === 'proposed' && !dismissed.has(a.id))
                  .slice(0, 5);
                if (visibleRecs.length === 0 && visibleActions.length === 0) return null;
                return (
                  <div className="ap-panel-recs">
                    <div className="ap-panel-recs-header">
                      <FiZap size={13} />
                      <span>Resultado del último análisis</span>
                    </div>
                    <ul className="ap-panel-recs-list">
                      {visibleRecs.map(r => {
                        const prio = r.prioridad || 'baja';
                        const prioVariant = PRIO_BADGE_VARIANT[prio] || 'gray';
                        return (
                          <li key={r.id} className={`ap-panel-rec ap-panel-rec--${prio}`}>
                            <div className="ap-panel-rec-head">
                              <span className={`aur-badge aur-badge--${prioVariant} ap-panel-rec-prio`}>
                                {prio}
                              </span>
                              <strong className="ap-panel-rec-title">{r.titulo || '(sin título)'}</strong>
                              <button
                                type="button"
                                className="aur-icon-btn aur-icon-btn--sm"
                                onClick={() => dismiss(r.id)}
                                title="Descartar"
                                aria-label="Descartar recomendación"
                              >
                                <FiX size={12} />
                              </button>
                            </div>
                            {r.descripcion && <p className="ap-panel-rec-desc">{r.descripcion}</p>}
                            {r.accionSugerida && (
                              <p className="ap-panel-rec-action">→ {r.accionSugerida}</p>
                            )}
                          </li>
                        );
                      })}
                      {visibleActions.map(a => {
                        const lock = getActionLevelLock(a.sourceMode, mode);
                        const prio = a.prioridad || 'media';
                        return (
                          <li key={a.id} className={`ap-panel-rec ap-panel-rec--accion ap-panel-rec--${prio}`}>
                            <div className="ap-panel-rec-head">
                              <span className="aur-badge aur-badge--violet ap-panel-rec-prio">
                                propuesta
                              </span>
                              <strong className="ap-panel-rec-title">{a.titulo || a.type || '(sin título)'}</strong>
                              <button
                                type="button"
                                className="aur-icon-btn aur-icon-btn--sm"
                                onClick={() => dismiss(a.id)}
                                title="Descartar"
                                aria-label="Descartar propuesta"
                              >
                                <FiX size={12} />
                              </button>
                            </div>
                            {a.descripcion && <p className="ap-panel-rec-desc">{a.descripcion}</p>}
                            {lock ? (
                              <p className="ap-panel-rec-locked">
                                <FiInfo size={11} /> Activa <strong>{lock.requiredLabel}</strong> para aprobar o rechazar.
                              </p>
                            ) : (
                              <Link
                                to="/autopilot"
                                onClick={() => { dismiss(a.id); onClose(); }}
                                className="ap-panel-rec-link"
                              >
                                Aprobar o rechazar <FiArrowRight size={11} />
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {(recommendations.filter(r => !dismissed.has(r.id)).length > 5
                      || proposedActions.filter(a => a.status === 'proposed' && !dismissed.has(a.id)).length > 5) && (
                      <Link
                        to="/autopilot"
                        onClick={onClose}
                        className="ap-panel-recs-more"
                      >
                        Ver todas en el panel <FiArrowRight size={11} />
                      </Link>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>

        <div className="ap-panel-footer">
          <Link to="/autopilot" onClick={onClose} className="ap-panel-footer-link">
            Ver más en el Panel de Aurora Copilot
          </Link>
        </div>
      </div>
    </>
  );
}
