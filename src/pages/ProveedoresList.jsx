import { useState, useEffect } from 'react';
import { FiTruck, FiEdit, FiTrash2, FiPlus, FiX, FiCheck, FiPhone, FiMail, FiMapPin, FiDollarSign } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './ProveedoresList.css';

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
};

const TIPO_PAGO_LABELS = { contado: 'Contado', credito: 'Crédito' };

function ProveedoresList() {
  const apiFetch = useApiFetch();
  const [proveedores, setProveedores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchProveedores = () =>
    apiFetch('/api/proveedores')
      .then(r => r.json())
      .then(setProveedores)
      .catch(() => showToast('Error al cargar proveedores.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => { fetchProveedores(); }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
  };

  const handleEdit = (p) => {
    setForm({ ...EMPTY_FORM, ...p });
    setIsEditing(true);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNew = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(true);
  };

  const handleDelete = async (id, nombre) => {
    if (!window.confirm(`¿Eliminar al proveedor "${nombre}"?`)) return;
    try {
      const res = await apiFetch(`/api/proveedores/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
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
      showToast(isEditing ? 'Proveedor actualizado.' : 'Proveedor creado.');
      resetForm();
      fetchProveedores();
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="prov-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Formulario ── */}
      {!showForm ? (
        <div className="prov-toolbar">
          <button className="btn btn-primary" onClick={handleNew}>
            <FiPlus size={15} /> Nuevo Proveedor
          </button>
        </div>
      ) : (
        <div className="prov-form-card">
          <div className="prov-form-header">
            <span>{isEditing ? 'Editar Proveedor' : 'Nuevo Proveedor'}</span>
            <button className="prov-close-btn" onClick={resetForm} title="Cancelar">
              <FiX size={16} />
            </button>
          </div>

          <form className="prov-form" onSubmit={handleSubmit}>
            <div className="prov-form-grid">
              <div className="prov-field prov-field--full">
                <label>Nombre <span className="prov-required">*</span></label>
                <input
                  name="nombre"
                  value={form.nombre}
                  onChange={handleChange}
                  placeholder="Razón social o nombre comercial"
                  required
                />
              </div>

              <div className="prov-field">
                <label>RUC / Cédula Jurídica</label>
                <input
                  name="ruc"
                  value={form.ruc}
                  onChange={handleChange}
                  placeholder="Ej. 3-101-123456"
                />
              </div>

              <div className="prov-field">
                <label>Teléfono</label>
                <input
                  name="telefono"
                  value={form.telefono}
                  onChange={handleChange}
                  placeholder="+506 2222-3333"
                />
              </div>

              <div className="prov-field">
                <label>Correo electrónico</label>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="ventas@proveedor.com"
                />
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
                  <input
                    type="number"
                    name="diasCredito"
                    value={form.diasCredito}
                    onChange={handleChange}
                    min="1"
                    placeholder="30"
                  />
                </div>
              )}

              <div className="prov-field prov-field--full">
                <label>Dirección</label>
                <input
                  name="direccion"
                  value={form.direccion}
                  onChange={handleChange}
                  placeholder="Dirección física o provincia"
                />
              </div>

              <div className="prov-field prov-field--full">
                <label>Notas</label>
                <textarea
                  name="notas"
                  value={form.notas}
                  onChange={handleChange}
                  placeholder="Condiciones especiales, productos que provee, contacto comercial…"
                  rows={2}
                />
              </div>
            </div>

            <div className="prov-form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Crear Proveedor'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Lista ── */}
      <section className="prov-section">
        <div className="prov-section-header">
          <FiTruck size={14} />
          <span>Proveedores registrados</span>
          {proveedores.length > 0 && (
            <span className="prov-count">{proveedores.length}</span>
          )}
          {showForm && (
            <button className="prov-add-inline" onClick={handleNew} title="Nuevo proveedor">
              <FiPlus size={13} />
            </button>
          )}
        </div>

        {loading ? (
          <p className="prov-empty">Cargando…</p>
        ) : proveedores.length === 0 ? (
          <div className="prov-empty-state">
            <FiTruck size={32} />
            <p>No hay proveedores registrados.</p>
            <button className="btn btn-primary" onClick={handleNew}>
              <FiPlus size={14} /> Agregar el primero
            </button>
          </div>
        ) : (
          <div className="prov-grid">
            {proveedores.map((p) => (
              <div key={p.id} className="prov-card">
                <div className="prov-card-top">
                  <div className="prov-card-name">{p.nombre}</div>
                  <div className="prov-card-actions">
                    <button className="prov-btn-icon" onClick={() => handleEdit(p)} title="Editar">
                      <FiEdit size={14} />
                    </button>
                    <button className="prov-btn-icon prov-btn-danger" onClick={() => handleDelete(p.id, p.nombre)} title="Eliminar">
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                </div>

                {p.ruc && (
                  <div className="prov-card-ruc">RUC: {p.ruc}</div>
                )}

                <div className="prov-card-meta">
                  {p.telefono && (
                    <span className="prov-meta-item">
                      <FiPhone size={11} /> {p.telefono}
                    </span>
                  )}
                  {p.email && (
                    <span className="prov-meta-item">
                      <FiMail size={11} /> {p.email}
                    </span>
                  )}
                  {p.direccion && (
                    <span className="prov-meta-item">
                      <FiMapPin size={11} /> {p.direccion}
                    </span>
                  )}
                </div>

                <div className="prov-card-footer">
                  <span className={`prov-badge prov-badge--${p.tipoPago}`}>
                    <FiDollarSign size={10} />
                    {TIPO_PAGO_LABELS[p.tipoPago] || p.tipoPago}
                    {p.tipoPago === 'credito' && p.diasCredito ? ` · ${p.diasCredito} días` : ''}
                  </span>
                  {p.notas && (
                    <span className="prov-card-notas" title={p.notas}>
                      {p.notas}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default ProveedoresList;
