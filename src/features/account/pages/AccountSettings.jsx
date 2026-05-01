import { useState, useEffect, useRef } from 'react';
import { FiUpload, FiSave, FiX, FiImage, FiEdit2 } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/account-settings.css';

const COMPANY_FIELDS = [
  { name: 'nombreEmpresa',      label: 'Nombre de la Empresa',  placeholder: 'Ej: Finca Aurora S.A.',          type: 'text' },
  { name: 'identificacion',     label: 'Identificación',         placeholder: 'Ej: 3-101-123456',               type: 'text' },
  { name: 'representanteLegal', label: 'Representante legal',    placeholder: 'Nombre del representante legal', type: 'text' },
  { name: 'administrador',      label: 'Administrador',          placeholder: 'Nombre del administrador',       type: 'text' },
  { name: 'direccion',          label: 'Dirección',              placeholder: 'Ej: Upala, Alajuela, Costa Rica', type: 'text' },
  { name: 'whatsapp',           label: 'Teléfono / WhatsApp',    placeholder: 'Ej: +506 8888-8888',             type: 'text' },
  { name: 'correo',             label: 'Correo electrónico',     placeholder: 'Ej: contacto@fincaaurora.com',   type: 'email' },
];

const EMPTY_FORM = { nombreEmpresa: '', identificacion: '', representanteLegal: '', administrador: '', direccion: '', whatsapp: '', correo: '', diasIDesarrollo: 250, diasIIDesarrollo: 215, diasPostForza: 150 };

function AccountSettings() {
  const apiFetch = useApiFetch();
  const [form, setForm]           = useState(EMPTY_FORM);
  const [savedForm, setSavedForm] = useState(EMPTY_FORM);
  const [logoUrl, setLogoUrl]     = useState('');
  const [preview, setPreview]     = useState('');
  const [logoFile, setLogoFile]   = useState(null);
  const [loading, setLoading]     = useState(false);
  const [editMode, setEditMode]   = useState(false);
  const [toast, setToast]         = useState(null);
  const fileRef                   = useRef();
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    apiFetch('/api/config')
      .then(r => r.json())
      .then(data => {
        const next = {
          nombreEmpresa:    data.nombreEmpresa    || '',
          identificacion:   data.identificacion   || '',
          representanteLegal: data.representanteLegal || '',
          administrador:    data.administrador    || '',
          direccion:        data.direccion        || '',
          whatsapp:         data.whatsapp         || '',
          correo:           data.correo           || '',
          diasIDesarrollo:  data.diasIDesarrollo  ?? 250,
          diasIIDesarrollo: data.diasIIDesarrollo ?? 215,
          diasPostForza:    data.diasPostForza    ?? 150,
        };
        setForm(next);
        setSavedForm(next);
        if (data.logoUrl) setLogoUrl(data.logoUrl);
      })
      .catch(console.error);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Solo se permiten imágenes.', 'error'); return; }
    if (file.size > 2 * 1024 * 1024)    { showToast('El logo no puede superar 2 MB.', 'error'); return; }
    setLogoFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const clearLogo = () => {
    setLogoFile(null);
    setPreview('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleEdit = () => setEditMode(true);

  const handleCancel = () => {
    setForm(savedForm);
    clearLogo();
    setEditMode(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
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
      if (!res.ok) throw new Error();
      const updated = await res.json();
      if (updated.logoUrl) { setLogoUrl(updated.logoUrl); clearLogo(); }
      setSavedForm(form);
      setEditMode(false);
      showToast('Configuración guardada correctamente.');
    } catch {
      showToast('Error al guardar la configuración.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const activeLogo = preview || logoUrl;

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <form onSubmit={handleSubmit} className="account-form">
        <header className="account-form-header">
          <h2 className="account-form-title">Configuración de la cuenta</h2>
          <div className="account-form-header-actions">
            {editMode ? (
              <>
                <button type="button" className="aur-btn-text" onClick={handleCancel} disabled={loading}>
                  <FiX size={14} /> Cancelar
                </button>
                <button type="submit" className="aur-btn-pill aur-btn-pill--sm" disabled={loading}>
                  <FiSave size={14} /> {loading ? 'Guardando…' : 'Guardar'}
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
            <h3 className="aur-section-title">Logo de la empresa</h3>
          </header>
          <div className="account-logo-area">
            {activeLogo ? (
              <div className="account-logo-preview-wrap">
                <img src={activeLogo} alt="Logo" className="account-logo-preview" />
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
                  <button type="button" className="aur-btn-text" onClick={() => fileRef.current.click()}>
                    <FiUpload size={15} />
                    {activeLogo ? 'Cambiar logo' : 'Subir logo'}
                  </button>
                  <p className="account-logo-hint">PNG o JPG · Máx. 2 MB · Recomendado: fondo transparente</p>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
          </div>
        </section>

        <section className="aur-section">
          <header className="aur-section-header">
            <h3 className="aur-section-title">Datos de la empresa</h3>
          </header>
          <ul className="aur-list">
            {COMPANY_FIELDS.map(f => (
              <li key={f.name} className="aur-row">
                <span className="aur-row-label">{f.label}</span>
                {editMode ? (
                  <input
                    className="aur-input"
                    id={f.name}
                    name={f.name}
                    type={f.type}
                    value={form[f.name]}
                    onChange={handleChange}
                    placeholder={f.placeholder}
                  />
                ) : (
                  <span className={`account-row-value${form[f.name] ? '' : ' account-row-value--empty'}`}>
                    {form[f.name] || '—'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </form>
    </div>
  );
}

export default AccountSettings;
