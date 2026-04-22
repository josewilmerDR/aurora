import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  FiCpu, FiRefreshCw, FiZap, FiAlertTriangle, FiInfo,
  FiSend, FiMic, FiMicOff, FiX, FiSliders, FiArrowRight, FiClock,
} from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import '../styles/autopilot-panel.css';

const MODE_LABELS = {
  off:    'Off',
  nivel1: 'Nivel 1',
  nivel2: 'Nivel 2',
  nivel3: 'Nivel 3',
};

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

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await apiFetch('/api/autopilot/analyze', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al analizar');
      setLastRun(data.timestamp);
      if (Array.isArray(data.proposedActions)) {
        setPendingCount(prev => prev + data.proposedActions.filter(a => a.status === 'proposed').length);
      }
      window.dispatchEvent(new CustomEvent('aurora-autopilot-changed'));
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

  const mode = config?.mode || 'off';

  return (
    <>
      {open && <div className="autopilot-panel-backdrop" onClick={onClose} />}
      <div className={`autopilot-panel${open ? ' open' : ''}`}>
        <div className="ap-panel-header">
          <div className="ap-panel-title">
            <FiCpu size={18} />
            <span>Piloto Automático</span>
            <span className={`ap-panel-mode ap-panel-mode--${mode}`}>
              {MODE_LABELS[mode] || mode}
            </span>
          </div>
          <button className="ap-panel-close" onClick={onClose} title="Cerrar">
            <FiX size={18} />
          </button>
        </div>

        <div className="ap-panel-body">
          {mode === 'off' && (
            <div className="ap-panel-notice">
              <FiInfo size={14} />
              <span>
                El Piloto Automático está desactivado.{' '}
                {canConfig ? (
                  <Link to="/autopilot/configuracion" onClick={onClose}>Activar</Link>
                ) : 'Pídele a un supervisor que lo active.'}
              </span>
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
            Panel completo
          </Link>
          {canConfig && (
            <Link to="/autopilot/configuracion" onClick={onClose} className="ap-panel-footer-link">
              <FiSliders size={13} /> Configuración
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
