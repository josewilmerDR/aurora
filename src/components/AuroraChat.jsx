import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiSend, FiPaperclip, FiX, FiMessageSquare, FiMic, FiMicOff, FiCheck, FiEdit2, FiBell, FiMapPin } from 'react-icons/fi';
import { useUser } from '../contexts/UserContext';
import { useApiFetch } from '../hooks/useApiFetch';
import './AuroraChat.css';

const MAX_IMAGE_PX = 1200;

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_PX || height > MAX_IMAGE_PX) {
          const ratio = Math.min(MAX_IMAGE_PX / width, MAX_IMAGE_PX / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', previewUrl: dataUrl });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export default function AuroraChat() {
  const apiFetch = useApiFetch();
  const { currentUser, activeFincaId } = useUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: '¡Hola! Soy Aurora, tu asistente de sistema.\n¿En qué puedo ayudarte hoy?' },
  ]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState(null);
  // Per-message draft state: { [msgIndex]: 'idle' | 'saving' | 'saved' | 'error' }
  const [draftStates, setDraftStates] = useState({});
  const [planillaDraftStates, setPlanillaDraftStates] = useState({});
  const [reminderBadge, setReminderBadge] = useState(0);

  const [pinned, setPinned] = useState(() =>
    localStorage.getItem('aurora_chat_pinned') === 'true'
  );

  const fileRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const recognitionRef = useRef(null);
  const pendingRemindersRef = useRef([]);
  const openRef = useRef(open);
  const panelRef = useRef(null);
  const fabRef = useRef(null);

  const speechSupported = !!SpeechRecognition;

  // Mantener openRef sincronizado para accederlo dentro de efectos asíncronos
  useEffect(() => { openRef.current = open; }, [open]);

  // Cerrar al hacer clic fuera del panel y del FAB (solo si no está fijado)
  useEffect(() => {
    if (!open || pinned) return;
    const handler = (e) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        fabRef.current   && !fabRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, pinned]);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open, thinking]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  // Verificar recordatorios vencidos cuando el usuario Y la finca están disponibles
  useEffect(() => {
    if (!currentUser?.uid || !activeFincaId) return;
    let cancelled = false;

    const checkDue = () => {
      apiFetch('/api/reminders/due').then(async res => {
        if (cancelled || !res.ok) return;
        const due = await res.json();
        if (!due.length) return;
        if (cancelled) return;
        if (openRef.current) {
          // El chat ya está abierto: inyectar directo
          setMessages(prev => [...prev, ...due.map(r => ({ role: 'reminder', text: r.message, remindAt: r.remindAt }))]);
        } else {
          // El chat está cerrado: mostrar badge y guardar para inyectar al abrir
          setReminderBadge(prev => prev + due.length);
          pendingRemindersRef.current = [...pendingRemindersRef.current, ...due];
        }
      }).catch(() => {});
    };

    checkDue(); // verificar al montar
    const interval = setInterval(checkDue, 60_000); // verificar cada minuto
    return () => { cancelled = true; clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, activeFincaId]);

  // Inyectar recordatorios vencidos como mensajes especiales al abrir el chat
  useEffect(() => {
    if (!open) return;
    const due = pendingRemindersRef.current;
    if (!due.length) return;
    pendingRemindersRef.current = [];
    setReminderBadge(0);
    setMessages(prev => [
      ...prev,
      ...due.map(r => ({
        role: 'reminder',
        text: r.message,
        remindAt: r.remindAt,
      })),
    ]);
  }, [open]);

  const handleImageFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await compressImage(file);
      setImage(data);
    } catch {
      // ignore
    }
  };

  const handleSend = useCallback(async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text && !image) return;
    if (thinking) return;

    const userMsg = { role: 'user', text: text || '(imagen adjunta)', imagePreview: image?.previewUrl };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    const sentImage = image;
    setImage(null);
    setThinking(true);

    try {
      // Enviar los últimos 20 mensajes como historial (excluye el saludo inicial)
      const history = messages
        .slice(1)
        .slice(-20)
        .map(m => ({ role: m.role, text: m.text }));

      const now = new Date();
      const body = {
        message: text || 'Por favor procesa esta imagen.',
        history,
        userId: currentUser?.uid || '',
        userName: currentUser?.nombre || '',
        clientTime: now.toISOString(),
        clientTzName: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clientTzOffset: now.getTimezoneOffset(), // minutos: positivo = atrás de UTC (ej: UTC-6 → 360)
      };
      if (sentImage) {
        body.imageBase64 = sentImage.base64;
        body.mediaType = sentImage.mediaType;
      }

      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const newMsg = { role: 'assistant', text: data.reply || 'No pude procesar la solicitud.' };
      if (data.horimetroDraft) newMsg.horimetroDraft = data.horimetroDraft;
      if (data.planillaDraft) newMsg.planillaDraft = data.planillaDraft;
      setMessages(prev => [...prev, newMsg]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Error de conexión. Por favor intenta de nuevo.' }]);
    } finally {
      setThinking(false);
    }
  }, [input, image, thinking, messages, currentUser, apiFetch]);

  // Listen for external open requests (e.g. from dashboard search bar)
  useEffect(() => {
    const handler = (e) => {
      setOpen(true);
      if (e.detail?.query) {
        handleSend(e.detail.query);
      }
    };
    window.addEventListener('aurora:open', handler);
    return () => window.removeEventListener('aurora:open', handler);
  }, [handleSend]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 100) + 'px';
    }
  };

  const toggleRecording = () => {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }

    setSpeechError(null);
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-CR';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    let finalTranscript = '';

    recognition.onstart = () => setRecording(true);

    recognition.onresult = (e) => {
      let interim = '';
      finalTranscript = '';
      for (const result of e.results) {
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      // Mostrar texto en el input mientras habla
      setInput(finalTranscript || interim);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 100) + 'px';
      }
    };

    recognition.onend = () => {
      setRecording(false);
      // Si hay transcripción final, enviar automáticamente
      if (finalTranscript.trim()) {
        handleSend(finalTranscript.trim());
      }
    };

    recognition.onerror = (e) => {
      setRecording(false);
      if (e.error === 'not-allowed') {
        setSpeechError('Permiso de micrófono denegado.');
      } else if (e.error !== 'no-speech') {
        setSpeechError('Error al reconocer voz. Intenta de nuevo.');
      }
    };

    recognition.start();
  };

  const handleDraftSave = async (filas, msgIndex) => {
    setDraftStates(prev => ({ ...prev, [msgIndex]: 'saving' }));
    try {
      for (const fila of filas) {
        const res = await apiFetch('/api/horimetro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fila),
        });
        if (!res.ok) throw new Error();
      }
      setDraftStates(prev => ({ ...prev, [msgIndex]: 'saved' }));
    } catch {
      setDraftStates(prev => ({ ...prev, [msgIndex]: 'error' }));
    }
  };

  const handleDraftReview = (filas) => {
    setOpen(false);
    navigate('/operaciones/horimetro', { state: { horimetroDraft: filas } });
  };

  const handlePlanillaSave = async (draft, msgIndex) => {
    setPlanillaDraftStates(prev => ({ ...prev, [msgIndex]: 'saving' }));
    try {
      // Compute totals
      const trabajadores = (draft.trabajadores || []).map(t => {
        const cantidades = t.cantidades || {};
        let total = 0;
        (draft.segmentos || []).forEach(seg => {
          const cant = parseFloat(cantidades[seg.id]) || 0;
          const costo = parseFloat(seg.costoUnitario) || 0;
          total += cant * costo;
        });
        return { ...t, total };
      });
      const totalGeneral = trabajadores.reduce((s, t) => s + (t.total || 0), 0);
      const body = {
        fecha: draft.fecha,
        encargadoId: draft.encargadoId || '',
        encargadoNombre: draft.encargadoNombre || '',
        segmentos: draft.segmentos || [],
        trabajadores,
        totalGeneral,
        estado: 'borrador',
        observaciones: draft.observaciones || '',
      };
      const res = await apiFetch('/api/hr/planilla-unidad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setPlanillaDraftStates(prev => ({ ...prev, [msgIndex]: 'saved' }));
    } catch {
      setPlanillaDraftStates(prev => ({ ...prev, [msgIndex]: 'error' }));
    }
  };

  const handlePlanillaReview = (draft) => {
    setOpen(false);
    navigate('/hr/planilla/horas', { state: { planillaDraft: draft } });
  };

  const renderPlanillaDraftCard = (draft, msgIndex) => {
    const state = planillaDraftStates[msgIndex] || 'idle';
    const nSegs = (draft.segmentos || []).length;
    const nTrab = (draft.trabajadores || []).length;
    return (
      <div className="aurora-draft-card">
        <p className="aurora-draft-title">📋 Planilla extraída del formulario</p>
        <table className="aurora-draft-table">
          <tbody>
            {draft.fecha && <tr><td className="aurora-draft-label">Fecha</td><td className="aurora-draft-value">{draft.fecha}</td></tr>}
            {draft.encargadoNombre && <tr><td className="aurora-draft-label">Encargado</td><td className="aurora-draft-value">{draft.encargadoNombre}</td></tr>}
            <tr><td className="aurora-draft-label">Segmentos</td><td className="aurora-draft-value">{nSegs} columna{nSegs !== 1 ? 's' : ''} de trabajo</td></tr>
            <tr><td className="aurora-draft-label">Trabajadores</td><td className="aurora-draft-value">{nTrab} trabajador{nTrab !== 1 ? 'es' : ''}</td></tr>
            {draft.observaciones && <tr><td className="aurora-draft-label">Obs.</td><td className="aurora-draft-value">{draft.observaciones}</td></tr>}
          </tbody>
        </table>
        {state === 'saved' ? (
          <p className="aurora-draft-saved">✓ Planilla guardada como borrador</p>
        ) : state === 'error' ? (
          <p className="aurora-draft-error">Error al guardar. Intenta de nuevo o revisa el formulario.</p>
        ) : (
          <div className="aurora-draft-actions">
            <button
              className="aurora-draft-btn aurora-draft-btn-primary"
              onClick={() => handlePlanillaSave(draft, msgIndex)}
              disabled={state === 'saving'}
            >
              <FiCheck size={13} /> {state === 'saving' ? 'Guardando…' : 'Guardar borrador'}
            </button>
            <button
              className="aurora-draft-btn aurora-draft-btn-secondary"
              onClick={() => handlePlanillaReview(draft)}
            >
              <FiEdit2 size={13} /> Abrir en formulario
            </button>
          </div>
        )}
      </div>
    );
  };

  const formatHours = (fila) => {
    if (fila.horimetroInicial != null && fila.horimetroFinal != null) {
      const h = (parseFloat(fila.horimetroFinal) - parseFloat(fila.horimetroInicial)).toFixed(1);
      return `${fila.horimetroInicial} → ${fila.horimetroFinal} (${h} h)`;
    }
    return null;
  };

  const filaRows = (fila) => [
    fila.fecha          && ['Fecha',      fila.fecha],
    fila.tractorNombre  && ['Tractor',    fila.tractorNombre],
    fila.implemento     && ['Implemento', fila.implemento],
    formatHours(fila)   && ['Horímetro',  formatHours(fila)],
    (fila.horaInicio || fila.horaFinal) && ['Horario', [fila.horaInicio, fila.horaFinal].filter(Boolean).join(' – ')],
    fila.loteNombre     && ['Lote',       fila.loteNombre + (fila.grupo ? ` / ${fila.grupo}` : '')],
    fila.labor          && ['Labor',      fila.labor],
    fila.operarioNombre && ['Operario',   fila.operarioNombre],
  ].filter(Boolean);

  const renderDraftCard = (draft, msgIndex) => {
    // draft is always an array of filas
    const filas = Array.isArray(draft) ? draft : [draft];
    const state = draftStates[msgIndex] || 'idle';

    return (
      <div className="aurora-draft-card">
        <p className="aurora-draft-title">📋 {filas.length > 1 ? `${filas.length} registros extraídos del formulario` : 'Datos extraídos del formulario'}</p>
        {filas.map((fila, idx) => (
          <div key={idx} className={filas.length > 1 ? 'aurora-draft-fila' : ''}>
            {filas.length > 1 && <p className="aurora-draft-fila-num">Fila {idx + 1}</p>}
            <table className="aurora-draft-table">
              <tbody>
                {filaRows(fila).map(([label, value]) => (
                  <tr key={label}>
                    <td className="aurora-draft-label">{label}</td>
                    <td className="aurora-draft-value">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {state === 'saved' ? (
          <p className="aurora-draft-saved">✓ {filas.length > 1 ? `${filas.length} registros guardados` : 'Registro guardado correctamente'}</p>
        ) : state === 'error' ? (
          <p className="aurora-draft-error">Error al guardar. Intenta de nuevo o revisa el formulario.</p>
        ) : (
          <div className="aurora-draft-actions">
            <button
              className="aurora-draft-btn aurora-draft-btn-primary"
              onClick={() => handleDraftSave(filas, msgIndex)}
              disabled={state === 'saving'}
            >
              <FiCheck size={13} /> {state === 'saving' ? 'Guardando…' : filas.length > 1 ? `Guardar ${filas.length} registros` : 'Guardar'}
            </button>
            <button
              className="aurora-draft-btn aurora-draft-btn-secondary"
              onClick={() => handleDraftReview(filas)}
            >
              <FiEdit2 size={13} /> Revisar en formulario
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {open && (
        <div className="aurora-chat-panel" ref={panelRef}>
          <div className="aurora-chat-header">
            <span className="aurora-chat-header-title">✦ Aurora</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              <button
                className={`aurora-chat-btn aurora-chat-pin-btn${pinned ? ' pinned' : ''}`}
                onClick={() => {
                  const next = !pinned;
                  setPinned(next);
                  localStorage.setItem('aurora_chat_pinned', String(next));
                }}
                title={pinned ? 'Desfijar chat' : 'Fijar chat (mantener abierto)'}
              >
                <FiMapPin size={15} />
              </button>
              <button className="aurora-chat-btn" onClick={() => setOpen(false)} title="Cerrar">
                <FiX size={16} />
              </button>
            </div>
          </div>

          <div className="aurora-chat-messages">
            {messages.map((msg, i) => (
              msg.role === 'reminder' ? (
                <div key={i} className="aurora-reminder-card">
                  <span className="aurora-reminder-icon"><FiBell size={14} /></span>
                  <div className="aurora-reminder-body">
                    <p className="aurora-reminder-label">Recordatorio</p>
                    <p className="aurora-reminder-text">{msg.text}</p>
                  </div>
                </div>
              ) : (
                <div key={i} className={`aurora-msg aurora-msg-${msg.role}`}>
                  {msg.imagePreview && (
                    <img src={msg.imagePreview} className="aurora-msg-image" alt="adjunto" />
                  )}
                  {msg.text}
                  {msg.horimetroDraft && renderDraftCard(msg.horimetroDraft, i)}
                  {msg.planillaDraft && renderPlanillaDraftCard(msg.planillaDraft, i)}
                </div>
              )
            ))}
            {thinking && (
              <div className="aurora-chat-thinking">
                <span className="aurora-thinking-dots">Aurora está procesando</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {image && (
            <div className="aurora-chat-img-bar">
              <div className="aurora-img-preview">
                <img src={image.previewUrl} alt="imagen adjunta" />
                <button
                  className="aurora-img-preview-remove"
                  onClick={() => setImage(null)}
                  title="Quitar imagen"
                >×</button>
              </div>
            </div>
          )}

          {speechError && (
            <div className="aurora-speech-error">{speechError}</div>
          )}

          <div className="aurora-chat-input-area">
            <button
              className="aurora-chat-btn"
              onClick={() => fileRef.current?.click()}
              title="Adjuntar imagen"
              disabled={thinking || recording}
            >
              <FiPaperclip size={17} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleImageFile}
            />

            <textarea
              ref={textareaRef}
              className="aurora-chat-input"
              placeholder={recording ? 'Escuchando…' : 'Escribe o usa el micrófono…'}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={thinking}
            />

            {speechSupported && (
              <button
                className={`aurora-chat-btn${recording ? ' aurora-chat-mic-active' : ''}`}
                onClick={toggleRecording}
                title={recording ? 'Detener grabación' : 'Hablar'}
                disabled={thinking}
              >
                {recording ? <FiMicOff size={17} /> : <FiMic size={17} />}
              </button>
            )}

            <button
              className="aurora-chat-btn aurora-chat-send"
              onClick={() => handleSend()}
              disabled={thinking || recording || (!input.trim() && !image)}
              title="Enviar"
            >
              <FiSend size={16} />
            </button>
          </div>
        </div>
      )}

      <button
        ref={fabRef}
        className={`aurora-chat-fab${open ? ' aurora-chat-fab-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Aurora AI"
      >
        {open ? <FiX size={22} /> : <FiMessageSquare size={22} />}
        {!open && reminderBadge > 0 && (
          <span className="aurora-chat-fab-badge">{reminderBadge}</span>
        )}
      </button>
    </>
  );
}
