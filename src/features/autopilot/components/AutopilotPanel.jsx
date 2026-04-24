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
  const [pendingCount, setPendingCount] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [conversation, setConversation] = useState([]);
  const [sessionId, setSessionId] = useState(null);

  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState(null);
  const recognitionRef = useRef(null);
  const chatEndRef = useRef(null);
  const voiceSupported = !!SpeechRec;

  // Refresh config + counts each time the panel opens
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
        }
        if (Array.isArray(actionsData)) {
          setPendingCount(actionsData.filter(a => a.status === 'proposed').length);
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
    if (Array.isArray(data.proposedActions)) {
      setPendingCount(prev => prev + data.proposedActions.filter(a => a.status === 'proposed').length);
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
        setPendingCount(c => c + data.proposedActions.length);
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
                  className="ap-panel-config-icon"
                  title="Configuración"
                  aria-label="Configuración"
                >
                  <FiSliders size={15} />
                </Link>
              )}
              <button className="ap-panel-close" onClick={onClose} title="Cerrar">
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
                  className="ap-panel-analyze-btn"
                  onClick={handleAnalyze}
                  disabled={analyzing}
                >
                  <FiRefreshCw size={13} className={analyzing ? 'ap-panel-spin' : ''} />
                  {analyzing ? 'Analizando…' : 'Analizar ahora'}
                </button>
              </div>

              {pendingCount > 0 && (
                <Link to="/autopilot" onClick={onClose} className="ap-panel-pending-card">
                  <FiZap size={14} />
                  <div className="ap-panel-pending-text">
                    <strong>{pendingCount}</strong> acción{pendingCount !== 1 ? 'es' : ''} pendiente{pendingCount !== 1 ? 's' : ''} de aprobar
                  </div>
                  <FiArrowRight size={14} />
                </Link>
              )}

              <div className="ap-panel-command">
                <label className="ap-panel-label">Comando / instrucción</label>
                <p className="ap-panel-command-help">
                  Dale una instrucción concreta a Aurora Copilot. Ej: <i>"Genera una orden de compra de 20 kg de Mancozeb a Almacenes El Éxito"</i> o <i>"Notifícale a María que la tarea del lote Norte se reprograma para el viernes"</i>. Todas las acciones quedan como <strong>propuestas</strong> para aprobación.
                </p>
                <textarea
                  className="ap-panel-textarea"
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
                      className={`ap-panel-mic${listening ? ' ap-panel-mic--on' : ''}`}
                      onClick={toggleListening}
                      disabled={sending}
                      title={listening ? 'Detener dictado' : 'Dictar por voz'}
                    >
                      {listening ? <FiMicOff size={14} /> : <FiMic size={14} />}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ap-panel-send"
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
                    className="ap-panel-reset"
                    onClick={handleReset}
                    disabled={sending}
                  >
                    Nueva conversación
                  </button>
                </>
              )}
            </>
          )}
        </div>

        <div className="ap-panel-footer">
          <Link to="/autopilot" onClick={onClose} className="ap-panel-footer-link">
            Ver toda la actividad de Aurora Copilot
          </Link>
        </div>
      </div>
    </>
  );
}
