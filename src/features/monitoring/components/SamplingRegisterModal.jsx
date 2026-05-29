import { useState, useEffect, useMemo, useRef } from 'react';
import { FiX, FiAlertCircle, FiFileText, FiCpu, FiPlus, FiTrash2, FiUpload, FiCheck } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import ImageLightbox from '../../../components/ImageLightbox';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import '../../applications/styles/packages.css';
import '../styles/sampling-register-modal.css';

const todayIso = () => new Date().toISOString().split('T')[0];

const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const MAX_IMAGE_PX = 1600;
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024; // 20MB before compression
const MAX_OBSERVACIONES = 2000;
const MAX_REGISTRO_VALUE = 500;
const DRAFT_KEY = (id) => `fmm_draft_${id}`;

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

export default function SamplingRegisterModal({ orden, onClose, onComplete }) {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const fileInputRef = useRef(null);
  const firstCellRef = useRef(null);
  const tableRef = useRef(null);

  // Plantilla state: 'loading' | 'no-formulario' | 'ready' | 'error'
  const [state, setState] = useState('loading');
  const [campos, setCampos] = useState([]);     // [{nombre, tipo, unidad}]
  const [registros, setRegistros] = useState([{}]); // [{nombre: value}, ...]
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Metadata
  const [fechaCarga, setFechaCarga] = useState(todayIso());
  const [observaciones, setObservaciones] = useState(orden.nota || '');
  const [supervisorId, setSupervisorId] = useState('');
  const [supervisorNombre, setSupervisorNombre] = useState('');
  const [supervisorLoading, setSupervisorLoading] = useState(false);
  const [users, setUsers] = useState([]);

  // Draft state: null = no saved draft, object = draft found and pending user decision
  const [draftData, setDraftData] = useState(null);

  // Wizard step: 1 = Datos generales, 2 = Datos del muestreo
  const [step, setStep] = useState(1);
  // Errores del paso 1 (intento de avanzar sin completar requeridos).
  const [step1Errors, setStep1Errors] = useState({});
  // Confirmación de cierre con datos. null | () => void  — guarda la acción de cierre pendiente.
  const [confirmCloseAction, setConfirmCloseAction] = useState(null);

  // Scan state
  const [scanImage, setScanImage] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null); // image to attach on save
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { src, caption }

  // ── Load campos ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!orden.paqueteMuestreoId) { setState('no-formulario'); return; }
      try {
        const pkgRes = await apiFetch(`/api/muestreos/paquetes/${orden.paqueteMuestreoId}`);
        if (!pkgRes.ok) throw new Error('No se pudo obtener el paquete');
        const pkg = await pkgRes.json();

        const activity = (pkg.activities || []).find(a => a.name === orden.tipoMuestreo);
        const formularios = activity?.formularios || [];
        if (formularios.length === 0) { if (!cancelled) setState('no-formulario'); return; }

        let plantillaCampos = null;
        for (const f of formularios) {
          const tipRes = await apiFetch(`/api/muestreos/tipos/${f.tipoId}`);
          if (!tipRes.ok) continue;
          const plantilla = await tipRes.json();
          if (Array.isArray(plantilla.campos) && plantilla.campos.length > 0) {
            plantillaCampos = plantilla.campos;
            break;
          }
        }

        if (!plantillaCampos) { if (!cancelled) setState('no-formulario'); return; }

        if (!cancelled) {
          const emptyRow = Object.fromEntries(plantillaCampos.map(c => [c.nombre, '']));
          setCampos(plantillaCampos);
          setRegistros([{ ...emptyRow }]);
          setState('ready');

          // Check for saved draft — only restore if it has data and matching campos
          try {
            const raw = localStorage.getItem(DRAFT_KEY(orden.id));
            if (raw) {
              const parsed = JSON.parse(raw);
              const currentKeys = plantillaCampos.map(c => c.nombre).join(',');
              const draftKeys = (parsed.campoKeys || []).join(',');
              const hasData = Array.isArray(parsed.registros) &&
                parsed.registros.some(row => Object.values(row).some(v => v !== ''));
              if (currentKeys === draftKeys && hasData) {
                setDraftData(parsed);
              } else {
                localStorage.removeItem(DRAFT_KEY(orden.id));
              }
            }
          } catch {
            try { localStorage.removeItem(DRAFT_KEY(orden.id)); } catch {}
          }
        }
      } catch (err) {
        if (!cancelled) { setErrorMsg(err.message || 'Error al cargar la plantilla'); setState('error'); }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Enfoca la primera celda al quedar listo el formulario.
  useEffect(() => {
    if (state === 'ready') firstCellRef.current?.focus();
  }, [state]);

  // Auto-save draft — only after the user has a pending draft decision resolved.
  useEffect(() => {
    if (state !== 'ready' || draftData !== null) return;
    const draft = {
      fechaCarga, observaciones, supervisorId, supervisorNombre,
      registros, campoKeys: campos.map(c => c.nombre),
    };
    try { localStorage.setItem(DRAFT_KEY(orden.id), JSON.stringify(draft)); } catch {}
  }, [registros, fechaCarga, observaciones, supervisorId, supervisorNombre, state, draftData]);

  // Detecta si el usuario llenó algún dato real (no se confunde con la
  // pre-fill de fechaCarga/observaciones). Sirve para gatear la confirmación
  // de cierre y para saber si hay algo que advertir.
  const isDirty = useMemo(() => {
    if (registros.some(r => Object.values(r).some(v => v !== ''))) return true;
    if (capturedImage) return true;
    if ((observaciones || '') !== (orden.nota || '')) return true;
    if (supervisorId) return true;
    return false;
  }, [registros, capturedImage, observaciones, supervisorId, orden.nota]);

  // Enter key navigation in registro table: moves focus down one row, adds row at end.
  const handleCellKeyDown = (e, rIdx, cIdx) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.shiftKey) {
      if (rIdx > 0) tableRef.current?.querySelector(`[data-row="${rIdx - 1}"][data-col="${cIdx}"]`)?.focus();
      return;
    }
    if (rIdx === registros.length - 1) {
      addRegistro();
      setTimeout(() => {
        tableRef.current?.querySelector(`[data-row="${rIdx + 1}"][data-col="${cIdx}"]`)?.focus();
      }, 0);
    } else {
      tableRef.current?.querySelector(`[data-row="${rIdx + 1}"][data-col="${cIdx}"]`)?.focus();
    }
  };

  // ── Fetch supervisor + users (para fallback de selección manual) ─────────
  useEffect(() => {
    const userId = currentUser?.userId;
    if (!userId) return;
    setSupervisorLoading(true);
    Promise.all([
      apiFetch(`/api/hr/fichas/${userId}`).then(r => r.json()).catch(() => ({})),
      apiFetch('/api/users/lite').then(r => r.json()).catch(() => []),
    ]).then(([ficha, allUsers]) => {
      setUsers(Array.isArray(allUsers) ? allUsers : []);
      if (ficha.encargadoId) {
        const sup = (allUsers || []).find(u => u.id === ficha.encargadoId);
        if (sup) { setSupervisorId(ficha.encargadoId); setSupervisorNombre(sup.nombre); }
      }
    }).finally(() => setSupervisorLoading(false));
  }, [currentUser?.userId]);

  const handleSupervisorPick = (id) => {
    setSupervisorId(id);
    setSupervisorNombre(users.find(u => u.id === id)?.nombre || '');
  };

  // ── Registro management ──────────────────────────────────────────────────
  const emptyRow = () => Object.fromEntries(campos.map(c => [c.nombre, '']));

  const addRegistro = () => setRegistros(prev => [...prev, emptyRow()]);

  const removeRegistro = (idx) =>
    setRegistros(prev => prev.filter((_, i) => i !== idx));

  const updateRegistro = (rIdx, nombre, val) =>
    setRegistros(prev => prev.map((r, i) => i === rIdx ? { ...r, [nombre]: val } : r));

  // ── Scan ─────────────────────────────────────────────────────────────────
  const handleImagePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScanMsg(null);
    if (!file.type.startsWith('image/')) {
      setScanMsg({ type: 'error', text: 'El archivo debe ser una imagen.' });
      return;
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setScanMsg({ type: 'error', text: 'La imagen supera 20 MB.' });
      return;
    }
    try {
      const compressed = await compressImage(file);
      setScanImage(compressed);
    } catch {
      setScanMsg({ type: 'error', text: 'No se pudo procesar la imagen.' });
    }
  };

  const handleScan = async () => {
    if (!scanImage || scanning) return;
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await apiFetch('/api/muestreos/escanear-formulario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: scanImage.base64, mediaType: scanImage.mediaType, campos }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al procesar la imagen');
      }
      const { registros: extracted } = await res.json();
      const emptyRowDef = Object.fromEntries(campos.map(c => [c.nombre, '']));
      const normalizedRows = extracted.map(r => ({ ...emptyRowDef, ...r }));
      // Replace last row if it's empty, otherwise append
      setRegistros(prev => {
        const last = prev[prev.length - 1];
        const lastIsEmpty = campos.every(c => !last?.[c.nombre]);
        const base = lastIsEmpty ? prev.slice(0, -1) : prev;
        return [...base, ...normalizedRows];
      });
      setCapturedImage(scanImage);
      setScanImage(null);
      setScanMsg({ type: 'success', text: 'Datos extraídos. Revisa y corrige si es necesario.' });
    } catch (err) {
      setScanMsg({ type: 'error', text: err.message || 'Error al escanear con IA.' });
    } finally {
      setScanning(false);
    }
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const formularioData = state === 'ready' ? { registros } : null;
      const metadata = {
        fechaCarga,
        supervisorId,
        observaciones,
        ...(capturedImage ? {
          scanImageBase64: capturedImage.base64,
          scanImageMediaType: capturedImage.mediaType,
        } : {}),
      };
      await onComplete(orden.id, formularioData, metadata);
      try { localStorage.removeItem(DRAFT_KEY(orden.id)); } catch {}
    } catch (err) {
      setSubmitError(err?.message || 'Error al guardar.');
    } finally {
      setSubmitting(false);
    }
  };

  // Cierre seguro: si hay datos sin guardar, pide confirmación. El borrador
  // queda persistido en localStorage de todas formas, así que el botón
  // "Cerrar igual" no destruye datos — solo confirma intención.
  const attemptClose = () => {
    if (submitting) return;
    if (isDirty) { setConfirmCloseAction(() => onClose); return; }
    onClose();
  };

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) attemptClose();
  };

  // Validación del paso 1: supervisor y fecha de muestreo son requeridos.
  // Si falta algo, no avanza y muestra error inline.
  const goToStep2 = () => {
    const errors = {};
    if (!fechaCarga) errors.fechaCarga = 'La fecha de muestreo es requerida.';
    if (!supervisorId) errors.supervisorId = 'Seleccioná un supervisor.';
    if (Object.keys(errors).length > 0) { setStep1Errors(errors); return; }
    setStep1Errors({});
    setStep(2);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="aur-modal-backdrop" onClick={handleBackdrop}>
      <div className="aur-modal aur-modal--xl fmm-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <header className="aur-modal-header fmm-header">
          <div className="aur-modal-title fmm-title">
            <span className="fmm-title-main">
              {step === 1 ? 'Datos generales' : 'Datos del muestreo'}
              <span className="fmm-step-badge">{step}/2</span>
            </span>
            <span className="fmm-title-sub">
              {orden.tipoMuestreo}
              {orden.grupoNombre && orden.grupoNombre !== '—' ? ` — ${orden.grupoNombre}` : ''}
            </span>
          </div>
          <button
            type="button"
            className="aur-icon-btn aur-icon-btn--sm aur-modal-close"
            onClick={attemptClose}
            disabled={submitting}
            aria-label="Cerrar"
          >
            <FiX size={16} />
          </button>
        </header>

        {/* Body */}
        <div className="aur-modal-content fmm-body">

          {/* ── Paso 1: Datos generales ──────────────────────────────────── */}
          {step === 1 && (
            <>
              {/* Draft restoration banner */}
              {draftData && (
                <div className="fmm-draft-banner" role="alert">
                  <span className="fmm-draft-banner-text">Hay un borrador guardado para esta orden.</span>
                  <button
                    type="button"
                    className="aur-btn-pill aur-btn-pill--sm"
                    onClick={() => {
                      setRegistros(draftData.registros);
                      if (draftData.fechaCarga) setFechaCarga(draftData.fechaCarga);
                      if (draftData.observaciones != null) setObservaciones(draftData.observaciones);
                      if (draftData.supervisorId) { setSupervisorId(draftData.supervisorId); setSupervisorNombre(draftData.supervisorNombre || ''); }
                      setDraftData(null);
                    }}
                  >
                    Restaurar
                  </button>
                  <button
                    type="button"
                    className="aur-btn-text"
                    onClick={() => {
                      try { localStorage.removeItem(DRAFT_KEY(orden.id)); } catch {}
                      setDraftData(null);
                    }}
                  >
                    Descartar
                  </button>
                </div>
              )}

              <section className="aur-section">
                <div className="aur-list">
                  <div className="aur-row">
                    <span className="aur-row-label">F. Programada</span>
                    <span className="fmm-meta-value">{fmtDate(orden.fechaProgramada)}</span>
                  </div>
                  <div className="aur-row">
                    <label className="aur-row-label" htmlFor="fmm-fecha">F. Muestreo</label>
                    <input
                      id="fmm-fecha"
                      type="date"
                      className={`aur-input${step1Errors.fechaCarga ? ' aur-input--error' : ''}`}
                      value={fechaCarga}
                      onChange={e => { setFechaCarga(e.target.value); if (step1Errors.fechaCarga) setStep1Errors(p => ({ ...p, fechaCarga: undefined })); }}
                      disabled={submitting}
                      aria-invalid={!!step1Errors.fechaCarga}
                    />
                  </div>
                  {step1Errors.fechaCarga && (
                    <div className="fmm-row-error">{step1Errors.fechaCarga}</div>
                  )}
                  <div className="aur-row">
                    <span className="aur-row-label">Muestreador</span>
                    <span className="fmm-meta-value">{currentUser?.nombre || '—'}</span>
                  </div>
                  <div className="aur-row">
                    <label className="aur-row-label" htmlFor="fmm-supervisor">Supervisor</label>
                    {supervisorLoading ? (
                      <span className="fmm-meta-value">...</span>
                    ) : supervisorId ? (
                      <span className="fmm-meta-value">{supervisorNombre}</span>
                    ) : (
                      <select
                        id="fmm-supervisor"
                        className={`aur-select${step1Errors.supervisorId ? ' aur-input--error' : ''}`}
                        value=""
                        onChange={e => { handleSupervisorPick(e.target.value); if (step1Errors.supervisorId) setStep1Errors(p => ({ ...p, supervisorId: undefined })); }}
                        disabled={submitting}
                        aria-invalid={!!step1Errors.supervisorId}
                      >
                        <option value="">Seleccionar supervisor…</option>
                        {users.map(u => (
                          <option key={u.id} value={u.id}>{u.nombre}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {step1Errors.supervisorId && (
                    <div className="fmm-row-error">{step1Errors.supervisorId}</div>
                  )}
                  <div className="aur-row">
                    <span className="aur-row-label">Lote</span>
                    <span className="fmm-meta-value">{orden.loteNombre || '—'}</span>
                  </div>
                  <div className="aur-row">
                    <span className="aur-row-label">Grupo</span>
                    <span className="fmm-meta-value">{orden.grupoNombre || '—'}</span>
                  </div>
                  <div className="aur-row aur-row--multiline">
                    <label className="aur-row-label" htmlFor="fmm-notas">Notas</label>
                    <div className="fmm-notas-wrap">
                      <textarea
                        id="fmm-notas"
                        className="aur-textarea"
                        value={observaciones}
                        onChange={e => setObservaciones(e.target.value)}
                        disabled={submitting}
                        placeholder="Observaciones del muestreo..."
                        maxLength={MAX_OBSERVACIONES}
                        rows={2}
                      />
                      <span className="fmm-char-count">{observaciones.length}/{MAX_OBSERVACIONES}</span>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* ── Paso 2: Datos del muestreo ───────────────────────────────── */}
          {step === 2 && (
            <section className="aur-section">
              <div className="aur-section-header">
                <h3>Registros</h3>
                {state === 'ready' && <span className="aur-section-count">{registros.length}</span>}
                {state === 'ready' && (
                  <span
                    className="fmm-autosave-indicator"
                    title="Tus cambios se guardan localmente como borrador. Si cerrás el modal, podrás retomar el registro más tarde."
                  >
                    <FiCheck size={11} aria-hidden="true" />
                    Borrador guardado
                  </span>
                )}
              </div>

              {state === 'loading' && <div className="fmm-state">Cargando plantilla...</div>}

              {state === 'error' && (
                <div className="fmm-state fmm-state--error">
                  <FiAlertCircle size={20} />
                  <span>{errorMsg}</span>
                  <span className="fmm-state-hint">Puedes guardar la orden sin llenar el formulario.</span>
                </div>
              )}

              {state === 'no-formulario' && (
                <div className="fmm-state fmm-state--empty">
                  <FiFileText size={20} />
                  <span>No hay campos definidos para esta plantilla.</span>
                  <span className="fmm-state-hint">
                    Puedes guardar la orden directamente, o definir los campos en Configuración → Plantillas.
                  </span>
                </div>
              )}

              {state === 'ready' && (
                <>
                  {/* Scan toolbar */}
                  <div className="fmm-scan-bar">
                    <div className="fmm-scan-bar-left">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        style={{ display: 'none' }}
                        onChange={handleImagePick}
                      />
                      {!scanImage ? (
                        <>
                          <button
                            className="btn btn-ia"
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={scanning || submitting}
                            title="Subí una foto del formulario lleno para leerlo con IA"
                          >
                            <FiUpload size={15} />
                            Subir imagen
                          </button>
                          <span className="fmm-upload-hint">JPG, PNG o WebP · máx. 20 MB</span>
                        </>
                      ) : (
                        <div className="fmm-scan-preview">
                          <button
                            type="button"
                            className="fmm-scan-thumb-btn"
                            onClick={() => setLightbox({ src: scanImage.previewUrl, caption: 'Imagen a procesar' })}
                            title="Ampliar imagen"
                          >
                            <img src={scanImage.previewUrl} alt="preview" className="fmm-scan-thumb" />
                          </button>
                          <button
                            className="fmm-scan-extract-btn"
                            type="button"
                            onClick={handleScan}
                            disabled={scanning || submitting}
                          >
                            <FiCpu size={13} />
                            {scanning ? 'Leyendo…' : 'Leer con IA'}
                          </button>
                          <button
                            type="button"
                            className="aur-btn-text"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={scanning || submitting}
                            title="Elegir otra imagen"
                          >
                            Cambiar
                          </button>
                          <button
                            type="button"
                            className="aur-icon-btn aur-icon-btn--sm"
                            onClick={() => { setScanImage(null); setScanMsg(null); }}
                            disabled={scanning || submitting}
                            title="Quitar imagen"
                          >
                            <FiX size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                    {scanMsg && (
                      <span className={`fmm-scan-msg fmm-scan-msg--${scanMsg.type}`}>
                        {scanMsg.text}
                      </span>
                    )}
                  </div>

                  {/* Imagen adjunta */}
                  {capturedImage && (
                    <div className="fmm-captured-bar">
                      <button
                        type="button"
                        className="fmm-scan-thumb-btn"
                        onClick={() => setLightbox({ src: capturedImage.previewUrl, caption: 'Imagen adjunta al registro' })}
                        title="Ampliar imagen"
                      >
                        <img src={capturedImage.previewUrl} alt="Imagen adjunta" className="fmm-scan-thumb" />
                      </button>
                      <span className="fmm-captured-label">Imagen adjunta — se guardará con el registro</span>
                      <button
                        type="button"
                        className="aur-icon-btn aur-icon-btn--sm"
                        onClick={() => setCapturedImage(null)}
                        disabled={submitting}
                        title="Quitar imagen adjunta"
                      >
                        <FiX size={13} />
                      </button>
                    </div>
                  )}

                  {/* Multi-registro table */}
                  <div className="aur-table-wrap">
                    <table ref={tableRef} className="aur-table fmm-registros-table">
                      <thead>
                        <tr>
                          <th className="fmm-reg-num">#</th>
                          {campos.map(c => (
                            <th key={c.nombre}>{c.nombre}</th>
                          ))}
                          <th className="fmm-reg-del-col" aria-hidden="true" />
                        </tr>
                      </thead>
                      <tbody>
                        {registros.map((reg, rIdx) => (
                          <tr key={rIdx}>
                            <td className="fmm-reg-num">{rIdx + 1}</td>
                            {campos.map((c, cIdx) => (
                              <td key={c.nombre} className="fmm-reg-td">
                                <input
                                  ref={rIdx === 0 && cIdx === 0 ? firstCellRef : null}
                                  className="fmm-reg-input"
                                  type={c.tipo === 'numero' ? 'number' : c.tipo === 'fecha' ? 'date' : 'text'}
                                  value={reg[c.nombre] ?? ''}
                                  onChange={e => updateRegistro(rIdx, c.nombre, e.target.value)}
                                  onKeyDown={e => handleCellKeyDown(e, rIdx, cIdx)}
                                  data-row={rIdx}
                                  data-col={cIdx}
                                  maxLength={MAX_REGISTRO_VALUE}
                                  disabled={submitting}
                                  aria-label={`${c.nombre} fila ${rIdx + 1}`}
                                />
                              </td>
                            ))}
                            <td className="fmm-reg-del-col">
                              {registros.length > 1 && (
                                <button
                                  type="button"
                                  className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                                  onClick={() => removeRegistro(rIdx)}
                                  disabled={submitting}
                                  title="Eliminar fila"
                                >
                                  <FiTrash2 size={12} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <button
                    type="button"
                    className="pkg-add-activity"
                    onClick={addRegistro}
                    disabled={submitting}
                  >
                    <FiPlus size={14} /> Agregar registro
                  </button>
                </>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="aur-modal-actions fmm-footer">
          {submitError && (
            <span className="fmm-submit-error" role="alert">
              <FiAlertCircle size={14} /> {submitError}
            </span>
          )}
          {step === 1 ? (
            <>
              <button type="button" className="aur-btn-text" onClick={attemptClose} disabled={submitting}>
                Cancelar
              </button>
              <button
                type="button"
                className="aur-btn-pill"
                onClick={goToStep2}
              >
                Siguiente →
              </button>
            </>
          ) : (
            <>
              <button type="button" className="aur-btn-text" onClick={() => setStep(1)} disabled={submitting}>
                ← Atrás
              </button>
              <button type="button" className="aur-btn-text" onClick={attemptClose} disabled={submitting}>
                Cancelar
              </button>
              <button
                type="button"
                className="aur-btn-pill"
                onClick={handleSubmit}
                disabled={submitting || state === 'loading'}
              >
                {submitting ? 'Guardando...' : 'Guardar'}
              </button>
            </>
          )}
        </div>

      </div>
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          caption={lightbox.caption}
          onClose={() => setLightbox(null)}
        />
      )}
      {confirmCloseAction && (
        <AuroraConfirmModal
          title="¿Cerrar sin guardar?"
          body={
            <>
              Tenés datos sin guardar en este registro. Tu borrador queda almacenado localmente
              en este dispositivo, así que podés retomarlo más tarde abriendo nuevamente la orden.
            </>
          }
          confirmLabel="Cerrar"
          cancelLabel="Seguir editando"
          iconVariant="warn"
          onConfirm={() => { const a = confirmCloseAction; setConfirmCloseAction(null); a?.(); }}
          onCancel={() => setConfirmCloseAction(null)}
        />
      )}
    </div>
  );
}
