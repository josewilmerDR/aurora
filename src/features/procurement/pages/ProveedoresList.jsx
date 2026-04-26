import { useState, useEffect, useRef } from 'react';
import {
  FiTruck, FiEdit, FiTrash2, FiPlus, FiCheck,
  FiPhone, FiMail, FiMapPin, FiDollarSign, FiUser,
  FiArrowLeft, FiChevronRight, FiGlobe, FiClock, FiTag,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/proveedores.css';

const EMPTY_FORM = {
  id: null,
  nombre: '',
  ruc: '',
  telefono: '',
  email: '',
  direccion: '',
  tipoPago: 'contado',
  diasCredito: 30,
  notas: '',
  moneda: 'USD',
  contacto: '',
  whatsapp: '',
  sitioWeb: '',
  paisOrigen: '',
  tiempoEntregaDias: '',
  limiteCredito: '',
  banco: '',
  cuentaBancaria: '',
  descuentoHabitual: '',
  categoria: '',
  estado: 'activo',
};

const TIPO_PAGO_LABELS = { contado: 'Contado', credito: 'Crédito' };

const CATEGORIA_LABELS = {
  agroquimicos: 'Agroquímicos',
  fertilizantes: 'Fertilizantes',
  maquinaria: 'Maquinaria',
  servicios: 'Servicios',
  combustible: 'Combustible',
  semillas: 'Semillas',
  otros: 'Otros',
};

// ── Draft persistence ─────────────────────────────────────────────────────────
const DRAFT_LS = 'aurora_draft_proveedor-nuevo';
const DRAFT_SS = 'aurora_draftActive_proveedor-nuevo';

function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_LS)); } catch { return null; } }
function saveDraft(data) {
  try {
    localStorage.setItem(DRAFT_LS, JSON.stringify(data));
    sessionStorage.setItem(DRAFT_SS, '1');
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_LS);
    sessionStorage.removeItem(DRAFT_SS);
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
const DRAFT_TEXT_FIELDS = ['nombre', 'ruc', 'telefono', 'email', 'direccion',
  'contacto', 'whatsapp', 'sitioWeb', 'paisOrigen', 'banco', 'cuentaBancaria', 'notas'];
function isDraftMeaningful(d) {
  return !!d && DRAFT_TEXT_FIELDS.some(k => d[k]?.trim());
}

const initials = (name) =>
  (name || '').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';

const safeHref = (url) => {
  if (typeof url !== 'string' || !url.trim()) return null;
  const candidate = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
};

function ProveedoresList() {
  const apiFetch = useApiFetch();
  const [proveedores, setProveedores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProveedor, setSelectedProveedor] = useState(null);
  const [view, setView] = useState('hub'); // 'hub' | 'form'
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const carouselRef = useRef(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  // Restore draft on mount (survives navigation and tab close)
  useEffect(() => {
    const draft = loadDraft();
    if (!isDraftMeaningful(draft)) return;
    setForm({ ...EMPTY_FORM, ...draft, id: null });
    setView('form');
    setIsEditing(false);
    try { sessionStorage.setItem(DRAFT_SS, '1'); window.dispatchEvent(new CustomEvent('aurora-draft-change')); } catch {}
  }, []);

  useEffect(() => {
    if (!selectedProveedor || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedProveedor]);

  const fetchProveedores = () =>
    apiFetch('/api/proveedores')
      .then(r => r.json())
      .then(data => { setProveedores(data); return data; })
      .catch(() => { showToast('Error al cargar proveedores.', 'error'); return []; })
      .finally(() => setLoading(false));

  useEffect(() => { fetchProveedores(); }, []);

  // Guarda borrador en cada cambio del formulario nuevo
  useEffect(() => {
    if (isEditing || view !== 'form') return;
    isDraftMeaningful(form) ? saveDraft(form) : clearDraft();
  }, [form, isEditing, view]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    if (!isEditing) clearDraft();
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setView('hub');
  };

  const handleSelectProveedor = (p) => {
    setSelectedProveedor(p);
    setView('hub');
    if (window.innerWidth <= 768)
      document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNew = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setView('form');
    setSelectedProveedor(null);
  };

  const handleEdit = (p) => {
    setForm({
      ...EMPTY_FORM,
      ...p,
      diasCredito: p.diasCredito ?? 30,
      tiempoEntregaDias: p.tiempoEntregaDias ?? '',
      limiteCredito: p.limiteCredito ?? '',
      descuentoHabitual: p.descuentoHabitual ?? '',
    });
    setIsEditing(true);
    setView('form');
  };

  const handleDelete = async (id) => {
    try {
      const res = await apiFetch(`/api/proveedores/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      if (selectedProveedor?.id === id) setSelectedProveedor(null);
      showToast('Proveedor eliminado.');
      fetchProveedores();
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) {
      showToast('El nombre es obligatorio.', 'error');
      return;
    }
    setSaving(true);
    try {
      const url = isEditing ? `/api/proveedores/${form.id}` : '/api/proveedores';
      const method = isEditing ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      const saved = await res.json();
      const freshList = await fetchProveedores();
      const savedId = isEditing ? form.id : saved.id;
      const found = freshList.find(p => p.id === savedId);
      if (found) setSelectedProveedor(found);
      showToast(isEditing ? 'Proveedor actualizado.' : 'Proveedor creado.');
      resetForm();
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Main panel ────────────────────────────────────────────────────────────
  const renderMainPanel = () => {
    if (view === 'form') {
      return (
        <div className="form-card">
          <h2>{isEditing ? 'Editar Proveedor' : 'Nuevo Proveedor'}</h2>
          <form onSubmit={handleSubmit}>
            <div className="prov-form-grid">

              {/* ── Datos básicos ── */}
              <div className="prov-field prov-field--full">
                <label>Nombre <span className="prov-required">*</span></label>
                <input name="nombre" value={form.nombre} onChange={handleChange} placeholder="Razón social o nombre comercial" required maxLength={150} />
              </div>
              <div className="prov-field">
                <label>RUC / Cédula Jurídica</label>
                <input name="ruc" value={form.ruc} onChange={handleChange} placeholder="Ej. 3-101-123456" maxLength={50} />
              </div>
              <div className="prov-field">
                <label>Teléfono</label>
                <input name="telefono" value={form.telefono} onChange={handleChange} placeholder="+506 2222-3333" maxLength={30} />
              </div>
              <div className="prov-field">
                <label>Correo electrónico</label>
                <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="ventas@proveedor.com" maxLength={200} />
              </div>
              <div className="prov-field">
                <label>Moneda <span className="prov-required">*</span></label>
                <select name="moneda" value={form.moneda} onChange={handleChange}>
                  <option value="USD">USD — Dólar</option>
                  <option value="CRC">CRC — Colón</option>
                </select>
              </div>
              <div className="prov-field">
                <label>Tipo de pago</label>
                <select name="tipoPago" value={form.tipoPago} onChange={handleChange}>
                  <option value="contado">Contado</option>
                  <option value="credito">Crédito</option>
                </select>
              </div>
              {form.tipoPago === 'credito' && (
                <div className="prov-field">
                  <label>Días de crédito</label>
                  <input type="number" name="diasCredito" value={form.diasCredito} onChange={handleChange} min="1" max="365" step="1" placeholder="30" />
                </div>
              )}

              {/* ── Contacto comercial ── */}
              <div className="prov-form-divider prov-field--full"><span>Contacto comercial</span></div>
              <div className="prov-field">
                <label>Persona de contacto</label>
                <input name="contacto" value={form.contacto} onChange={handleChange} placeholder="Nombre del representante" maxLength={200} />
              </div>
              <div className="prov-field">
                <label>WhatsApp</label>
                <input name="whatsapp" value={form.whatsapp} onChange={handleChange} placeholder="+506 8888-7777" maxLength={30} />
              </div>
              <div className="prov-field prov-field--full">
                <label>Sitio web</label>
                <input type="url" name="sitioWeb" value={form.sitioWeb} onChange={handleChange} placeholder="https://proveedor.com" maxLength={300} />
              </div>

              {/* ── Clasificación ── */}
              <div className="prov-form-divider prov-field--full"><span>Clasificación</span></div>
              <div className="prov-field">
                <label>Categoría</label>
                <select name="categoria" value={form.categoria} onChange={handleChange}>
                  <option value="">— Sin categoría —</option>
                  <option value="agroquimicos">Agroquímicos</option>
                  <option value="fertilizantes">Fertilizantes</option>
                  <option value="maquinaria">Maquinaria y equipo</option>
                  <option value="servicios">Servicios</option>
                  <option value="combustible">Combustible</option>
                  <option value="semillas">Semillas</option>
                  <option value="otros">Otros</option>
                </select>
              </div>
              <div className="prov-field">
                <label>Estado</label>
                <select name="estado" value={form.estado} onChange={handleChange}>
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </div>
              <div className="prov-field">
                <label>País de origen</label>
                <input name="paisOrigen" value={form.paisOrigen} onChange={handleChange} placeholder="Ej. Costa Rica, EE.UU." maxLength={200} />
              </div>
              <div className="prov-field">
                <label>Tiempo de entrega (días)</label>
                <input type="number" name="tiempoEntregaDias" value={form.tiempoEntregaDias} onChange={handleChange} min="0" max="365" step="1" placeholder="3" />
              </div>

              {/* ── Financiero ── */}
              <div className="prov-form-divider prov-field--full"><span>Financiero</span></div>
              <div className="prov-field">
                <label>Límite de crédito</label>
                <input type="number" name="limiteCredito" value={form.limiteCredito} onChange={handleChange} min="0" step="0.01" placeholder="0.00" />
              </div>
              <div className="prov-field">
                <label>Descuento habitual (%)</label>
                <input type="number" name="descuentoHabitual" value={form.descuentoHabitual} onChange={handleChange} min="0" max="100" step="0.01" placeholder="0" />
              </div>
              <div className="prov-field">
                <label>Banco</label>
                <input name="banco" value={form.banco} onChange={handleChange} placeholder="Ej. BCR, BAC, Davivienda" maxLength={200} />
              </div>
              <div className="prov-field">
                <label>Cuenta bancaria</label>
                <input name="cuentaBancaria" value={form.cuentaBancaria} onChange={handleChange} placeholder="Número de cuenta o IBAN" maxLength={100} />
              </div>

              <div className="prov-field prov-field--full">
                <label>Dirección</label>
                <input name="direccion" value={form.direccion} onChange={handleChange} placeholder="Dirección física o provincia" maxLength={300} />
              </div>
              <div className="prov-field prov-field--full">
                <label>Notas</label>
                <textarea name="notas" value={form.notas} onChange={handleChange} placeholder="Condiciones especiales, productos que provee, contacto comercial…" rows={2} maxLength={2000} />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="aur-btn-pill" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar Proveedor' : 'Crear Proveedor'}
              </button>
              <button type="button" onClick={resetForm} className="aur-btn-text">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      );
    }

    if (!selectedProveedor) return null;

    const p = selectedProveedor;
    const sitioWebHref = safeHref(p.sitioWeb);
    return (
      <div className="lote-hub">
        <button className="lote-hub-back" onClick={() => setSelectedProveedor(null)}>
          <FiArrowLeft size={13} /> Todos los proveedores
        </button>

        <div className="hub-header">
          <div className="hub-title-block">
            <h2 className="prov-hub-nombre">
              {p.nombre}
              {p.moneda && (
                <span className={`prov-moneda-tag prov-moneda-tag--${p.moneda}`}>{p.moneda}</span>
              )}
            </h2>
          </div>
          <div className="hub-header-actions">
            <button className="aur-icon-btn" onClick={() => handleEdit(p)} title="Editar proveedor">
              <FiEdit size={16} />
            </button>
            <button className="aur-icon-btn aur-icon-btn--danger" onClick={() => setConfirmDelete(p)} title="Eliminar proveedor">
              <FiTrash2 size={16} />
            </button>
          </div>
        </div>

        <div className="hub-info-pills">
          {p.categoria && (
            <span className="hub-pill">
              <FiTag size={13} />
              {CATEGORIA_LABELS[p.categoria] || p.categoria}
            </span>
          )}
          {p.tipoPago && (
            <span className="hub-pill">
              <FiDollarSign size={13} />
              {TIPO_PAGO_LABELS[p.tipoPago] || p.tipoPago}
              {p.tipoPago === 'credito' && p.diasCredito ? ` · ${p.diasCredito} días` : ''}
            </span>
          )}
          {p.paisOrigen && (
            <span className="hub-pill">
              <FiMapPin size={13} />
              {p.paisOrigen}
            </span>
          )}
          {p.estado === 'inactivo' && (
            <span className="hub-pill prov-pill-inactivo">Inactivo</span>
          )}
        </div>

        <div className="prov-detail-sections">

          {/* Contacto */}
          {(p.contacto || p.telefono || p.whatsapp || p.email || sitioWebHref) && (
            <div className="prov-detail-section">
              <h4 className="prov-detail-section-title">Contacto</h4>
              <div className="prov-detail-rows">
                {p.contacto && (
                  <div className="prov-detail-row">
                    <FiUser size={13} />
                    <span className="prov-detail-label">Representante</span>
                    <span className="prov-detail-value">{p.contacto}</span>
                  </div>
                )}
                {p.telefono && (
                  <div className="prov-detail-row">
                    <FiPhone size={13} />
                    <span className="prov-detail-label">Teléfono</span>
                    <span className="prov-detail-value">{p.telefono}</span>
                  </div>
                )}
                {p.whatsapp && (
                  <div className="prov-detail-row">
                    <FiPhone size={13} />
                    <span className="prov-detail-label">WhatsApp</span>
                    <span className="prov-detail-value">{p.whatsapp}</span>
                  </div>
                )}
                {p.email && (
                  <div className="prov-detail-row">
                    <FiMail size={13} />
                    <span className="prov-detail-label">Email</span>
                    <span className="prov-detail-value">{p.email}</span>
                  </div>
                )}
                {sitioWebHref && (
                  <div className="prov-detail-row">
                    <FiGlobe size={13} />
                    <span className="prov-detail-label">Sitio web</span>
                    <a href={sitioWebHref} target="_blank" rel="noopener noreferrer">{p.sitioWeb}</a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Identificación */}
          {(p.ruc || p.direccion) && (
            <div className="prov-detail-section">
              <h4 className="prov-detail-section-title">Identificación</h4>
              <div className="prov-detail-rows">
                {p.ruc && (
                  <div className="prov-detail-row">
                    <span className="prov-detail-label">RUC</span>
                    <span className="prov-detail-value">{p.ruc}</span>
                  </div>
                )}
                {p.direccion && (
                  <div className="prov-detail-row">
                    <FiMapPin size={13} />
                    <span className="prov-detail-label">Dirección</span>
                    <span className="prov-detail-value">{p.direccion}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Condiciones financieras */}
          {(p.limiteCredito || p.descuentoHabitual || p.banco || p.cuentaBancaria) && (
            <div className="prov-detail-section">
              <h4 className="prov-detail-section-title">Condiciones financieras</h4>
              <div className="prov-detail-rows">
                {p.limiteCredito && (
                  <div className="prov-detail-row">
                    <FiDollarSign size={13} />
                    <span className="prov-detail-label">Límite</span>
                    <span className="prov-detail-value">
                      {p.moneda} {Number(p.limiteCredito).toLocaleString()}
                    </span>
                  </div>
                )}
                {p.descuentoHabitual && (
                  <div className="prov-detail-row">
                    <span className="prov-detail-label">Descuento</span>
                    <span className="prov-detail-value">{p.descuentoHabitual}%</span>
                  </div>
                )}
                {p.banco && (
                  <div className="prov-detail-row">
                    <span className="prov-detail-label">Banco</span>
                    <span className="prov-detail-value">{p.banco}</span>
                  </div>
                )}
                {p.cuentaBancaria && (
                  <div className="prov-detail-row">
                    <span className="prov-detail-label">Cuenta</span>
                    <span className="prov-detail-value">{p.cuentaBancaria}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Logística */}
          {p.tiempoEntregaDias != null && p.tiempoEntregaDias !== '' && (
            <div className="prov-detail-section">
              <h4 className="prov-detail-section-title">Logística</h4>
              <div className="prov-detail-rows">
                <div className="prov-detail-row">
                  <FiClock size={13} />
                  <span className="prov-detail-label">Entrega</span>
                  <span className="prov-detail-value">
                    {p.tiempoEntregaDias} día{Number(p.tiempoEntregaDias) !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Notas */}
          {p.notas && (
            <div className="prov-detail-section">
              <h4 className="prov-detail-section-title">Notas</h4>
              <p className="prov-detail-notas">{p.notas}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`lote-page${selectedProveedor && view === 'hub' ? ' lote-page--selected' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {!loading && proveedores.length === 0 && view !== 'form' ? (
        <div className="prov-empty-state">
          <FiTruck size={32} />
          <p>No hay proveedores aún.</p>
          <button className="aur-btn-pill" onClick={handleNew}>
            <FiPlus size={14} /> Crear el primero
          </button>
        </div>
      ) : (
        <>
          {/* ── Mobile carousel ── */}
          {selectedProveedor && view === 'hub' && (
            <div className="lote-carousel" ref={carouselRef}>
              {proveedores.map(p => (
                <button
                  key={p.id}
                  className={`lote-bubble${selectedProveedor?.id === p.id ? ' lote-bubble--active' : ''}`}
                  onClick={() =>
                    selectedProveedor?.id === p.id
                      ? setSelectedProveedor(null)
                      : handleSelectProveedor(p)
                  }
                >
                  <span className="lote-bubble-avatar">{initials(p.nombre)}</span>
                  <span className="lote-bubble-label">{p.nombre}</span>
                </button>
              ))}
              <button className="lote-bubble lote-bubble--add" onClick={handleNew}>
                <span className="lote-bubble-avatar lote-bubble-avatar--add">+</span>
                <span className="lote-bubble-label">Nuevo</span>
              </button>
            </div>
          )}

          {view !== 'form' && (
            <div className="lote-page-header">
              <h2 className="lote-page-title">Proveedores</h2>
              <button className="aur-btn-pill" onClick={handleNew}>
                <FiPlus /> Nuevo Proveedor
              </button>
            </div>
          )}

          <div className="lote-management-layout">
            {renderMainPanel()}

            {view !== 'form' && (
              <div className="lote-list-panel">
                {loading ? (
                  <p className="hub-loading">Cargando…</p>
                ) : (
                  <ul className="lote-list">
                    {proveedores.map(p => (
                      <li
                        key={p.id}
                        className={`lote-list-item${selectedProveedor?.id === p.id && view === 'hub' ? ' active' : ''}`}
                        onClick={() =>
                          selectedProveedor?.id === p.id && view === 'hub'
                            ? setSelectedProveedor(null)
                            : handleSelectProveedor(p)
                        }
                      >
                        <div className="prov-list-info">
                          <span className="prov-list-name">
                            {p.nombre}
                            {p.moneda && (
                              <span className={`prov-moneda-tag prov-moneda-tag--${p.moneda}`}>
                                {p.moneda}
                              </span>
                            )}
                          </span>
                          {p.categoria && (
                            <span className="prov-list-sub">
                              {CATEGORIA_LABELS[p.categoria] || p.categoria}
                            </span>
                          )}
                          {p.estado === 'inactivo' && (
                            <span className="prov-list-sub prov-list-inactivo">Inactivo</span>
                          )}
                        </div>
                        <FiChevronRight size={14} className="lote-list-arrow" />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar proveedor"
          body={`¿Eliminar al proveedor "${confirmDelete.nombre}"?`}
          confirmLabel="Eliminar"
          onConfirm={() => { handleDelete(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default ProveedoresList;
