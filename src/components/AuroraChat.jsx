import { useState, useRef, useEffect, useCallback } from 'react';
import { FiSend, FiPaperclip, FiX, FiMessageSquare, FiMic, FiMicOff } from 'react-icons/fi';
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
  const { currentUser } = useUser();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: '¡Hola! Soy Aurora.\nPuedo registrar siembras desde texto, foto o voz. ¿En qué te ayudo?' },
  ]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState(null);

  const fileRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const recognitionRef = useRef(null);

  const speechSupported = !!SpeechRecognition;

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open, thinking]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  // Listen for external open requests (e.g. from dashboard search bar)
  useEffect(() => {
    const handler = (e) => {
      setOpen(true);
      if (e.detail?.query) {
        setInput(e.detail.query);
        setTimeout(() => textareaRef.current?.focus(), 100);
      }
    };
    window.addEventListener('aurora:open', handler);
    return () => window.removeEventListener('aurora:open', handler);
  }, []);

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
      const body = {
        message: text || 'Por favor procesa esta imagen.',
        userId: currentUser?.id || '',
        userName: currentUser?.nombre || '',
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
      setMessages(prev => [...prev, { role: 'assistant', text: data.reply || 'No pude procesar la solicitud.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Error de conexión. Por favor intenta de nuevo.' }]);
    } finally {
      setThinking(false);
    }
  }, [input, image, thinking, currentUser, apiFetch]);

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

  return (
    <>
      {open && (
        <div className="aurora-chat-panel">
          <div className="aurora-chat-header">
            <span className="aurora-chat-header-title">✦ Aurora</span>
            <button className="aurora-chat-btn" onClick={() => setOpen(false)} title="Cerrar">
              <FiX size={16} />
            </button>
          </div>

          <div className="aurora-chat-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`aurora-msg aurora-msg-${msg.role}`}>
                {msg.imagePreview && (
                  <img src={msg.imagePreview} className="aurora-msg-image" alt="adjunto" />
                )}
                {msg.text}
              </div>
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
        className={`aurora-chat-fab${open ? ' aurora-chat-fab-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Aurora AI"
      >
        {open ? <FiX size={22} /> : <FiMessageSquare size={22} />}
      </button>
    </>
  );
}
