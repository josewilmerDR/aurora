import { useState, useEffect } from 'react';
import { FiSave, FiX } from 'react-icons/fi';

const EMPTY = {
  id: null,
  name: '',
  taxId: '',
  phone: '',
  email: '',
  address: '',
  paymentType: 'contado',
  creditDays: 30,
  currency: 'USD',
  contact: '',
  whatsapp: '',
  website: '',
  country: '',
  creditLimit: '',
  notes: '',
  status: 'activo',
};

function BuyerForm({ initial, onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => { setForm(initial ? { ...EMPTY, ...initial } : EMPTY); }, [initial]);

  const update = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form className="lote-form-card" onSubmit={handleSubmit}>
      <div className="finance-form-grid">
        <div className="finance-field">
          <label>Nombre del comprador *</label>
          <input type="text" value={form.name} onChange={update('name')} required />
        </div>
        <div className="finance-field">
          <label>Cédula jurídica / RUC</label>
          <input type="text" value={form.taxId} onChange={update('taxId')} />
        </div>
        <div className="finance-field">
          <label>Teléfono</label>
          <input type="text" value={form.phone} onChange={update('phone')} />
        </div>
        <div className="finance-field">
          <label>Email</label>
          <input type="email" value={form.email} onChange={update('email')} />
        </div>
        <div className="finance-field">
          <label>Contacto principal</label>
          <input type="text" value={form.contact} onChange={update('contact')} />
        </div>
        <div className="finance-field">
          <label>WhatsApp</label>
          <input type="text" value={form.whatsapp} onChange={update('whatsapp')} />
        </div>
        <div className="finance-field finance-field-full">
          <label>Dirección</label>
          <input type="text" value={form.address} onChange={update('address')} />
        </div>
        <div className="finance-field">
          <label>Sitio web</label>
          <input type="text" value={form.website} onChange={update('website')} />
        </div>
        <div className="finance-field">
          <label>País</label>
          <input type="text" value={form.country} onChange={update('country')} />
        </div>
        <div className="finance-field">
          <label>Forma de pago</label>
          <select value={form.paymentType} onChange={update('paymentType')}>
            <option value="contado">Contado</option>
            <option value="credito">Crédito</option>
          </select>
        </div>
        {form.paymentType === 'credito' && (
          <div className="finance-field">
            <label>Días de crédito</label>
            <input type="number" min="1" max="365" value={form.creditDays} onChange={update('creditDays')} />
          </div>
        )}
        <div className="finance-field">
          <label>Moneda</label>
          <select value={form.currency} onChange={update('currency')}>
            <option value="USD">USD</option>
            <option value="CRC">CRC</option>
          </select>
        </div>
        <div className="finance-field">
          <label>Límite de crédito</label>
          <input type="number" min="0" step="0.01" value={form.creditLimit} onChange={update('creditLimit')} />
        </div>
        <div className="finance-field">
          <label>Estado</label>
          <select value={form.status} onChange={update('status')}>
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </select>
        </div>
        <div className="finance-field finance-field-full">
          <label>Notas</label>
          <textarea rows="3" value={form.notes} onChange={update('notes')} />
        </div>
      </div>
      <div className="lote-form-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          <FiX /> Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          <FiSave /> {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}

export default BuyerForm;
