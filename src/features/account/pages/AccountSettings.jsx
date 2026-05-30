import { useState, useEffect, useRef, useCallback } from 'react';
import { FiUpload, FiSave, FiX, FiImage, FiEdit2, FiAlertTriangle, FiBriefcase, FiCalendar, FiInfo } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import EmptyState from '../../../components/ui/EmptyState';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { translateApiError } from '../../../lib/errorMessages';
import {
  COMPANY_FIELDS, TIMING_FIELDS, EMPTY_FORM,
  ALLOWED_LOGO_TYPES, MAX_LOGO_BYTES,
  fromApi, getInvalidKeys, hasUnsavedChanges,
} from '../lib/account-settings';
import '../styles/account-settings.css';

// MODELO DE EDICIÓN (divergencia intencional con Profile): esta página usa un
// modo Editar→Guardar global con dirty-state, guard de beforeunload y ESC para
// cancelar, porque escribe un doc de config compartido y multi-campo de forma
// atómica. Profile, en cambio, aplica cada acción de inmediato y por fila
// porque son operaciones individuales e idempotentes. No unificar a ciegas: la
// asimetría entre las dos páginas del dominio es deliberada.
function AccountSettings() {
  const apiFetch = useApiFetch();
  const [form, setForm]               = useState(EMPTY_FORM);
  const [savedForm, setSavedForm]     = useState(EMPTY_FORM);
  const [logoUrl, setLogoUrl]         = useState('');
  const [preview, setPreview]         = useState('');
  const [logoFile, setLogoFile]       = useState(null);
  const [loadingPage, setLoadingPage] = useState(true);   // carga inicial
  const [loadError, setLoadError]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [editMode, setEditMode]       = useState(false);
  const [invalidKeys, setInvalidKeys] = useState([]);
  const [toast, setToast]             = useState(null);
  const fileRef                       = useRef();
  const previewUrlRef                 = useRef('');        // para revokeObjectURL
  const showToast = (message, type = 'success') => setToast({ message, type });

  const loadConfig = useCallback((signal) => {
    setLoadingPage(true);
    setLoadError(false);
    return apiFetch('/api/config', signal ? { signal } : undefined)
      .then(r => { if (!r.ok) throw new Error('config load failed'); return r.json(); })
      .then(data => {
        setForm(fromApi(data));
        setSavedForm(fromApi(data));
        setLogoUrl(data.logoUrl || '');
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        setLoadError(true);
      })
      .finally(() => { if (!signal?.aborted) setLoadingPage(false); });
  }, [apiFetch]);

  // Carga inicial; aborta en desmontaje para no setear estado sobre un
  // componente muerto (y maneja el doble-render de StrictMode sin warning).
  useEffect(() => {
    const ctrl = new AbortController();
    loadConfig(ctrl.signal);
    return () => ctrl.abort();
  }, [loadConfig]);

  // Libera el object URL de la preview al desmontar (evita leak de memoria).
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const dirty = editMode && (hasUnsavedChanges(savedForm, form) || Boolean(logoFile));

  // Aviso del navegador si se intenta cerrar/recargar con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setInvalidKeys(prev => (prev.includes(name) ? prev.filter(k => k !== name) : prev));
  };

  const setPreviewUrl = (url) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreview(url);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) { showToast('Formato no admitido. Usá PNG, JPG o WebP.', 'error'); return; }
    if (file.size > MAX_LOGO_BYTES)              { showToast('El logo no puede superar 2 MB.', 'error'); return; }
    setLogoFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const clearLogo = () => {
    setLogoFile(null);
    setPreviewUrl('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleEdit = () => setEditMode(true);

  const handleCancel = useCallback(() => {
    setForm(savedForm);
    clearLogo();
    setInvalidKeys([]);
    setEditMode(false);
  }, [savedForm]);

  // ESC cancela la edición (cierra el "modo" innermost de la página).
  useEffect(() => {
    if (!editMode) return;
    const onKey = (e) => { if (e.key === 'Escape') handleCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, handleCancel]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const invalid = getInvalidKeys(form);
    if (invalid.length > 0) {
      setInvalidKeys(invalid);
      showToast('Hay campos inválidos (marcados en rojo). Corregilos antes de guardar.', 'error');
      return;
    }

    setSaving(true);
    try {
      const body = { ...form };

      if (logoFile) {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(logoFile);
        });
        body.logoBase64 = base64;
        body.mediaType  = logoFile.type;
      }

      const res = await apiFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Parseamos el body en error y traducimos vía translateApiError, que lee
      // el `code` del backend (VALIDATION_FAILED, RATE_LIMITED, FORBIDDEN,
      // EXTERNAL_SERVICE_ERROR del upload de logo…) a un mensaje en español
      // específico. Antes un throw vacío daba el mismo toast genérico para todo
      // y ocultaba, p. ej., el 429 del rate limit o qué campo rechazó el server.
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(translateApiError(body, 'Error al guardar la configuración.'));
      }
      const updated = await res.json();
      if (updated.logoUrl) { setLogoUrl(updated.logoUrl); clearLogo(); }
      setSavedForm(fromApi(updated));
      setForm(fromApi(updated));
      setInvalidKeys([]);
      setEditMode(false);
      showToast('Configuración guardada correctamente.');
    } catch (err) {
      showToast(err?.message || 'Error al guardar la configuración.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const activeLogo = preview || logoUrl;
  // Habilitar Guardar sólo si hay cambios (o un guardado en curso, para no
  // togglear el disabled a mitad de la petición).
  const canSave = saving || dirty;

  return (
    <div className="aur-sheet">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {loadingPage ? (
        <div className="aur-page-loading" role="status" aria-label="Cargando configuración" />
      ) : loadError ? (
        <EmptyState
          icon={FiAlertTriangle}
          title="No se pudo cargar la configuración"
          subtitle="Revisá tu conexión o tus permisos e intentá de nuevo."
          action={(
            <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={() => loadConfig()}>
              Reintentar
            </button>
          )}
        />
      ) : (
      <form onSubmit={handleSubmit} className="account-form">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h2 className="aur-sheet-title">Configuración de la cuenta</h2>
            <p className="aur-sheet-subtitle">Identidad de la empresa y días de proyección de cosecha.</p>
          </div>
          <div className="aur-sheet-header-actions">
            {editMode ? (
              <>
                <button type="button" className="aur-btn-text" onClick={handleCancel} disabled={saving}>
                  <FiX size={14} /> Cancelar
                </button>
                <button type="submit" className="aur-btn-pill aur-btn-pill--sm" disabled={!canSave}>
                  <FiSave size={14} /> {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </>
            ) : (
              <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleEdit}>
                <FiEdit2 size={14} /> Editar
              </button>
            )}
          </div>
        </header>

        <section className="aur-section">
          <header className="aur-section-header">
            <span className="aur-section-num"><FiImage size={14} /></span>
            <h3 className="aur-section-title">Logo de la empresa</h3>
          </header>
          <div className="account-logo-area">
            {activeLogo ? (
              <div className="account-logo-preview-wrap">
                <img src={activeLogo} alt="Logo de la empresa" className="account-logo-preview" />
                {preview && editMode && (
                  <button
                    type="button"
                    className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger account-logo-clear"
                    onClick={clearLogo}
                    title="Quitar selección"
                    aria-label="Quitar selección"
                  >
                    <FiX size={14} />
                  </button>
                )}
              </div>
            ) : (
              <div className="account-logo-placeholder">
                <FiImage size={28} />
                <span>Sin logo</span>
              </div>
            )}
            <div className="account-logo-controls">
              {editMode && (
                <>
                  <button type="button" className="aur-btn-pill" onClick={() => fileRef.current.click()}>
                    <FiUpload size={15} />
                    {activeLogo ? 'Cambiar logo' : 'Subir logo'}
                  </button>
                  <p className="account-logo-hint">PNG, JPG o WebP · Máx. 2 MB · Recomendado: fondo transparente</p>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept={ALLOWED_LOGO_TYPES.join(',')}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
          </div>
        </section>

        <section className="aur-section">
          <header className="aur-section-header">
            <span className="aur-section-num"><FiBriefcase size={14} /></span>
            <h3 className="aur-section-title">Datos de la empresa</h3>
          </header>
          <ul className="aur-list">
            {COMPANY_FIELDS.map(f => {
              const isInvalid = invalidKeys.includes(f.name);
              return (
                <li key={f.name} className="aur-row">
                  <label className="aur-row-label" htmlFor={f.name}>{f.label}</label>
                  {editMode ? (
                    <input
                      className={`aur-input${isInvalid ? ' aur-input--error' : ''}`}
                      id={f.name}
                      name={f.name}
                      type={f.type}
                      value={form[f.name]}
                      onChange={handleChange}
                      placeholder={f.placeholder}
                      aria-invalid={isInvalid || undefined}
                      inputMode={f.type === 'tel' ? 'tel' : undefined}
                    />
                  ) : (
                    <span className={`account-row-value${form[f.name] ? '' : ' account-row-value--empty'}`}>
                      {form[f.name] || '—'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="aur-section">
          <header className="aur-section-header">
            <span className="aur-section-num"><FiCalendar size={14} /></span>
            <h3 className="aur-section-title">Días de desarrollo</h3>
          </header>
          {/* Nota canónica (aur-banner--info, igual que param-section-note) — siempre
              visible, no solo en editMode, para que el usuario entienda el alcance
              de estos días tanto leyendo como editando. La 2ª frase desambigua el
              solapamiento con «Parámetros del sistema», que guarda los demás
              valores de referencia de proyección/costos de la plataforma. */}
          <div className="aur-banner aur-banner--info account-section-note">
            <FiInfo size={14} />
            <span>
              Estos días alimentan las fechas estimadas de las proyecciones de cosecha por grupo.
              Los demás parámetros de proyección y costos se configuran en «Parámetros del sistema».
            </span>
          </div>
          <ul className="aur-list">
            {TIMING_FIELDS.map(f => {
              const isInvalid = invalidKeys.includes(f.name);
              return (
                <li key={f.name} className="aur-row">
                  <label className="aur-row-label" htmlFor={f.name}>{f.label}</label>
                  {editMode ? (
                    <input
                      className={`aur-input aur-input--num${isInvalid ? ' aur-input--error' : ''}`}
                      id={f.name}
                      name={f.name}
                      type="number"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={form[f.name]}
                      onChange={handleChange}
                      aria-invalid={isInvalid || undefined}
                    />
                  ) : (
                    <span className="account-row-value">{form[f.name]} días</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </form>
      )}
    </div>
  );
}

export default AccountSettings;
