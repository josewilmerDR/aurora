import { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { FiX, FiAlertCircle, FiFileText, FiCamera, FiZap } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './FormularioMuestreoModal.css';

// STATE: 'loading' | 'no-formulario' | 'ready' | 'error'

const MAX_IMAGE_PX = 1600;

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

export default function FormularioMuestreoModal({ orden, onClose, onComplete }) {
  const apiFetch = useApiFetch();
  const fileInputRef = useRef(null);

  // Form loading state
  const [state, setState] = useState('loading');
  const [sheetRows, setSheetRows] = useState([]);
  const [sheetName, setSheetName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Image scan state
  const [scanImage, setScanImage] = useState(null); // { base64, mediaType, previewUrl }
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState(null); // { type: 'success'|'error', text }

  // ── Load Excel template ──────────────────────────────────────────────────
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
        if (formularios.length === 0) {
          if (!cancelled) setState('no-formulario');
          return;
        }

        // Buscar la primera plantilla que tenga archivoFormulario
        let archivoUrl = null;
        let archivoNombre = null;
        for (const f of formularios) {
          const tipRes = await apiFetch(`/api/monitoreo/tipos/${f.tipoId}`);
          if (!tipRes.ok) continue;
          const plantilla = await tipRes.json();
          if (plantilla.archivoFormulario?.url) {
            archivoUrl = plantilla.archivoFormulario.url;
            archivoNombre = plantilla.archivoFormulario.nombre;
            break;
          }
        }

        if (!archivoUrl) {
          if (!cancelled) setState('no-formulario');
          return;
        }

        const fileRes = await fetch(archivoUrl);
        if (fileRes.status === 404) {
          if (!cancelled) setState('no-formulario');
          return;
        }
        if (!fileRes.ok) throw new Error(`No se pudo descargar el formulario: ${archivoNombre}`);
        const buffer = await fileRes.arrayBuffer();

        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const raw = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        const maxCols = Math.max(...raw.map(r => r.length), 1);
        const normalized = raw.map(r => {
          const arr = r.map(c => (c === null || c === undefined) ? '' : String(c));
          while (arr.length < maxCols) arr.push('');
          return arr;
        });

        if (!cancelled) {
          setSheetName(firstSheetName);
          setSheetRows(normalized);
          setState('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err.message || 'Error al cargar el formulario');
          setState('error');
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Cell editing ─────────────────────────────────────────────────────────
  const handleCellChange = useCallback((rIdx, cIdx, value) => {
    setSheetRows(prev =>
      prev.map((row, ri) =>
        ri === rIdx ? row.map((cell, ci) => (ci === cIdx ? value : cell)) : row
      )
    );
  }, []);

  // ── Image scan ───────────────────────────────────────────────────────────
  const handleImagePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScanMsg(null);
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
        body: JSON.stringify({
          imageBase64: scanImage.base64,
          mediaType: scanImage.mediaType,
          plantilla: sheetRows,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al procesar la imagen');
      }
      const { rows } = await res.json();
      setSheetRows(rows);
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
    try {
      const formularioData = state === 'ready' ? { sheetName, rows: sheetRows } : null;
      await onComplete(orden.id, formularioData);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !submitting) onClose();
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fmm-overlay" onClick={handleOverlayClick}>
      <div className="fmm-modal">

        {/* Header */}
        <div className="fmm-header">
          <div className="fmm-title">
            <span className="fmm-title-main">Registrar resultado de muestreo</span>
            <span className="fmm-title-sub">
              {orden.tipoMuestreo}
              {orden.grupoNombre && orden.grupoNombre !== '—' ? ` — ${orden.grupoNombre}` : ''}
            </span>
          </div>
          <button className="fmm-close" onClick={onClose} disabled={submitting} type="button">
            <FiX size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="fmm-body">
          {state === 'loading' && (
            <div className="fmm-state">Cargando formulario...</div>
          )}

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
              <span>No hay formulario disponible para esta actividad.</span>
              <span className="fmm-state-hint">
                La plantilla no tiene archivo adjunto o el archivo fue actualizado recientemente.
                Puedes marcar la orden como hecha directamente.
              </span>
            </div>
          )}

          {state === 'ready' && (
            <>
              {/* ── Scan toolbar ── */}
              <div className="fmm-scan-bar">
                <div className="fmm-scan-bar-left">
                  <button
                    className="fmm-scan-pick-btn"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={scanning || submitting}
                    title="Seleccionar imagen del formulario físico"
                  >
                    <FiCamera size={14} />
                    {scanImage ? 'Cambiar imagen' : 'Escanear desde imagen'}
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
                        <FiZap size={13} />
                        {scanning ? 'Extrayendo...' : 'Extraer con IA'}
                      </button>
                      <button
                        className="fmm-scan-clear-btn"
                        type="button"
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

              {/* ── Editable table ── */}
              <div className="fmm-table-wrap">
                {sheetName && <div className="fmm-sheet-label">{sheetName}</div>}
                <table className="fmm-table">
                  <tbody>
                    {sheetRows.map((row, rIdx) => (
                      <tr key={rIdx} className={rIdx === 0 ? 'fmm-row-header' : 'fmm-row-data'}>
                        <td className="fmm-row-num">{rIdx + 1}</td>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="fmm-cell-td">
                            <input
                              className="fmm-cell-input"
                              value={cell}
                              onChange={e => handleCellChange(rIdx, cIdx, e.target.value)}
                              spellCheck={false}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="fmm-footer">
          <button
            className="fmm-btn fmm-btn--cancel"
            onClick={onClose}
            disabled={submitting}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="fmm-btn fmm-btn--submit"
            onClick={handleSubmit}
            disabled={submitting || state === 'loading'}
            type="button"
          >
            {submitting ? 'Guardando...' : 'Guardar y marcar como hecha'}
          </button>
        </div>

      </div>
    </div>
  );
}
