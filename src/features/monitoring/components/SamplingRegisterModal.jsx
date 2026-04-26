import { useState, useEffect, useRef } from 'react';
import { FiX, FiAlertCircle, FiFileText, FiCpu, FiPlus, FiTrash2 } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import '../../applications/styles/packages.css';
import '../styles/sampling-register-modal.css';

const todayIso = () => new Date().toISOString().split('T')[0];

const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
};

const MAX_IMAGE_PX = 1600;
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024; // 20MB before compression
const MAX_OBSERVACIONES = 2000;
const MAX_REGISTRO_VALUE = 500;

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

  // Scan state
  const [scanImage, setScanImage] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null); // image to attach on save
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);

  // ── Load campos ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!orden.paqueteMuestreoId) { setState('no-formulario'); return; }
      try {
        const pkgRes = await apiFetch(`/api/monitoreo/paquetes/${orden.paqueteMuestreoId}`);
        if (!pkgRes.ok) throw new Error('No se pudo obtener el paquete');
        const pkg = await pkgRes.json();

        const activity = (pkg.activities || []).find(a => a.name === orden.tipoMuestreo);
        const formularios = activity?.formularios || [];
        if (formularios.length === 0) { if (!cancelled) setState('no-formulario'); return; }

        let plantillaCampos = null;
        for (const f of formularios) {
          const tipRes = await apiFetch(`/api/monitoreo/tipos/${f.tipoId}`);
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

  // ── Fetch supervisor ─────────────────────────────────────────────────────
  useEffect(() => {
    const userId = currentUser?.userId;
    if (!userId) return;
    setSupervisorLoading(true);
    Promise.all([
      apiFetch(`/api/hr/fichas/${userId}`).then(r => r.json()).catch(() => ({})),
      apiFetch('/api/users').then(r => r.json()).catch(() => []),
    ]).then(([ficha, users]) => {
      if (ficha.encargadoId) {
        const sup = users.find(u => u.id === ficha.encargadoId);
        if (sup) { setSupervisorId(ficha.encargadoId); setSupervisorNombre(sup.nombre); }
      }
    }).finally(() => setSupervisorLoading(false));
  }, [currentUser?.userId]);

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
    } catch (err) {
      setSubmitError(err?.message || 'Error al guardar.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget && !submitting) onClose();
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="aur-modal-backdrop" onPointerDown={handleBackdrop}>
      <div className="aur-modal aur-modal--xl fmm-modal" onPointerDown={(e) => e.stopPropagation()}>

        {/* Header */}
        <header className="aur-modal-header fmm-header">
          <div className="aur-modal-title fmm-title">
            <span className="fmm-title-main">Registrar resultado de muestreo</span>
            <span className="fmm-title-sub">
              {orden.tipoMuestreo}
              {orden.grupoNombre && orden.grupoNombre !== '—' ? ` — ${orden.grupoNombre}` : ''}
            </span>
          </div>
          <button
            type="button"
            className="aur-icon-btn aur-icon-btn--sm aur-modal-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar"
          >
            <FiX size={16} />
          </button>
        </header>

        {/* Body */}
        <div className="aur-modal-content fmm-body">

          {/* Datos generales — settings list */}
          <section className="aur-section">
            <div className="aur-section-header">
              <h3>Datos generales</h3>
            </div>
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
                  className="aur-input"
                  value={fechaCarga}
                  onChange={e => setFechaCarga(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="aur-row">
                <span className="aur-row-label">Muestreador</span>
                <span className="fmm-meta-value">{currentUser?.nombre || '—'}</span>
              </div>
              <div className="aur-row">
                <span className="aur-row-label">Supervisor</span>
                <span className="fmm-meta-value">
                  {supervisorLoading ? '...' : (supervisorNombre || '—')}
                </span>
              </div>
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
              </div>
            </div>
          </section>

          {/* Datos del muestreo — registros + scan */}
          <section className="aur-section">
            <div className="aur-section-header">
              <h3>Datos del muestreo</h3>
              {state === 'ready' && <span className="aur-section-count">{registros.length}</span>}
            </div>

            {state === 'loading' && <div className="fmm-state">Cargando plantilla...</div>}

            {state === 'error' && (
              <div className="fmm-state fmm-state--error">
                <FiAlertCircle size={20} />
                <span>{errorMsg}</span>
                <span className="fmm-state-hint">Puedes marcar la orden como hecha sin llenar el formulario.</span>
              </div>
            )}

            {state === 'no-formulario' && (
              <div className="fmm-state fmm-state--empty">
                <FiFileText size={20} />
                <span>No hay campos definidos para esta plantilla.</span>
                <span className="fmm-state-hint">
                  Puedes marcar la orden como hecha directamente, o definir los campos en la configuración de Plantillas.
                </span>
              </div>
            )}

            {state === 'ready' && (
              <>
                {/* Scan toolbar — brand-specific decorative (magenta accent for AI) */}
                <div className="fmm-scan-bar">
                  <div className="fmm-scan-bar-left">
                    <button
                      className="btn btn-ia"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={scanning || submitting}
                      title="Leer con IA — agrega o rellena la última fila vacía"
                    >
                      <FiCpu size={15} />
                      {scanImage ? 'Cambiar imagen' : 'Leer con IA'}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={handleImagePick}
                    />
                    {scanImage && (
                      <div className="fmm-scan-preview">
                        <img src={scanImage.previewUrl} alt="preview" className="fmm-scan-thumb" />
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

                {/* Imagen adjunta al registro */}
                {capturedImage && (
                  <div className="fmm-captured-bar">
                    <img src={capturedImage.previewUrl} alt="Imagen adjunta" className="fmm-scan-thumb" />
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
                  <table className="aur-table fmm-registros-table">
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
        </div>

        {/* Footer */}
        <div className="aur-modal-actions fmm-footer">
          {submitError && (
            <span className="fmm-submit-error" role="alert">
              <FiAlertCircle size={14} /> {submitError}
            </span>
          )}
          <button type="button" className="aur-btn-text" onClick={onClose} disabled={submitting}>
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
        </div>

      </div>
    </div>
  );
}
