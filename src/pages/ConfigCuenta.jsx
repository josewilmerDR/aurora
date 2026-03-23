import { useState, useEffect, useRef } from 'react';
import { FiUpload, FiSave, FiX } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './ConfigCuenta.css';

function ConfigCuenta() {
  const apiFetch = useApiFetch();
  const [form, setForm]       = useState({ nombreEmpresa: '', identificacion: '', representanteLegal: '', administrador: '', direccion: '', whatsapp: '', correo: '', diasIDesarrollo: 250, diasIIDesarrollo: 215, diasPostForza: 150 });
  const [logoUrl, setLogoUrl] = useState('');
  const [preview, setPreview] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast]     = useState(null);
  const fileRef               = useRef();
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    apiFetch('/api/config')
      .then(r => r.json())
      .then(data => {
        setForm({
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
        });
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

      <div className="form-card config-card">
        <form onSubmit={handleSubmit} className="lote-form">

          {/* Logo */}
          <p className="form-section-title">Logo de la Empresa</p>
          <div className="logo-upload-area">
            {activeLogo ? (
              <div className="logo-preview-wrapper">
                <img src={activeLogo} alt="Logo" className="logo-preview" />
                {preview && (
                  <button type="button" className="logo-clear-btn" onClick={clearLogo} title="Quitar selección">
                    <FiX size={14} />
                  </button>
                )}
              </div>
            ) : (
              <div className="logo-placeholder">
                <FiUpload size={28} />
                <span>Sin logo</span>
              </div>
            )}
            <div className="logo-upload-controls">
              <button type="button" className="btn btn-secondary" onClick={() => fileRef.current.click()}>
                <FiUpload size={15} />
                {activeLogo ? 'Cambiar logo' : 'Subir logo'}
              </button>
              <p className="logo-hint">PNG o JPG · Máx. 2 MB · Recomendado: fondo transparente</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
          </div>

          {/* Datos empresa */}
          <p className="form-section-title">Datos de la Empresa</p>
          <div className="form-grid">
            <div className="form-control">
              <label htmlFor="nombreEmpresa">Nombre de la Empresa</label>
              <input
                id="nombreEmpresa" name="nombreEmpresa"
                value={form.nombreEmpresa} onChange={handleChange}
                placeholder="Ej: Finca Aurora S.A."
              />
            </div>
            <div className="form-control">
              <label htmlFor="identificacion">Identificación</label>
              <input
                id="identificacion" name="identificacion"
                value={form.identificacion} onChange={handleChange}
                placeholder="Ej: 3-101-123456"
              />
            </div>
            <div className="form-control">
              <label htmlFor="representanteLegal">Representante legal</label>
              <input
                id="representanteLegal" name="representanteLegal"
                value={form.representanteLegal} onChange={handleChange}
                placeholder="Nombre del representante legal"
              />
            </div>
            <div className="form-control">
              <label htmlFor="administrador">Administrador</label>
              <input
                id="administrador" name="administrador"
                value={form.administrador} onChange={handleChange}
                placeholder="Nombre del administrador"
              />
            </div>
            <div className="form-control" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="direccion">Dirección</label>
              <input
                id="direccion" name="direccion"
                value={form.direccion} onChange={handleChange}
                placeholder="Ej: Upala, Alajuela, Costa Rica"
              />
            </div>
            <div className="form-control">
              <label htmlFor="whatsapp">Teléfono / WhatsApp</label>
              <input
                id="whatsapp" name="whatsapp"
                value={form.whatsapp} onChange={handleChange}
                placeholder="Ej: +506 8888-8888"
              />
            </div>
            <div className="form-control">
              <label htmlFor="correo">Correo electrónico</label>
              <input
                id="correo" name="correo" type="email"
                value={form.correo} onChange={handleChange}
                placeholder="Ej: contacto@fincaaurora.com"
              />
            </div>
          </div>


          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              <FiSave size={16} />
              {loading ? 'Guardando...' : 'Guardar Configuración'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

export default ConfigCuenta;
