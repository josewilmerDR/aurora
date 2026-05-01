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
    <form onSubmit={handleSubmit} noValidate>
      <section className="aur-section">
        <div className="aur-section-header">
          <h3 className="aur-section-title">Identificación</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-name">Nombre del comprador</label>
            <input
              id="bu-name"
              type="text"
              className="aur-input"
              value={form.name}
              onChange={update('name')}
              required
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-taxid">Cédula jurídica / RUC</label>
            <input
              id="bu-taxid"
              type="text"
              className="aur-input"
              value={form.taxId}
              onChange={update('taxId')}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-country">País</label>
            <input
              id="bu-country"
              type="text"
              className="aur-input"
              value={form.country}
              onChange={update('country')}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-status">Estado</label>
            <select
              id="bu-status"
              className="aur-select"
              value={form.status}
              onChange={update('status')}
            >
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>
        </div>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <h3 className="aur-section-title">Contacto</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-contact">Contacto principal</label>
            <input
              id="bu-contact"
              type="text"
              className="aur-input"
              value={form.contact}
              onChange={update('contact')}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-phone">Teléfono</label>
            <input
              id="bu-phone"
              type="text"
              className="aur-input"
              value={form.phone}
              onChange={update('phone')}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-whatsapp">WhatsApp</label>
            <input
              id="bu-whatsapp"
              type="text"
              className="aur-input"
              value={form.whatsapp}
              onChange={update('whatsapp')}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-email">Email</label>
            <input
              id="bu-email"
              type="email"
              className="aur-input"
              value={form.email}
              onChange={update('email')}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-website">Sitio web</label>
            <input
              id="bu-website"
              type="text"
              className="aur-input"
              value={form.website}
              onChange={update('website')}
            />
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="bu-address">Dirección</label>
            <input
              id="bu-address"
              type="text"
              className="aur-input"
              value={form.address}
              onChange={update('address')}
            />
          </div>
        </div>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <h3 className="aur-section-title">Pago y crédito</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-paytype">Forma de pago</label>
            <select
              id="bu-paytype"
              className="aur-select"
              value={form.paymentType}
              onChange={update('paymentType')}
            >
              <option value="contado">Contado</option>
              <option value="credito">Crédito</option>
            </select>
          </div>
          {form.paymentType === 'credito' && (
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="bu-creditdays">Días de crédito</label>
              <input
                id="bu-creditdays"
                type="number"
                className="aur-input aur-input--num"
                min="1"
                max="365"
                value={form.creditDays}
                onChange={update('creditDays')}
              />
            </div>
          )}
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-currency">Moneda</label>
            <select
              id="bu-currency"
              className="aur-select"
              value={form.currency}
              onChange={update('currency')}
            >
              <option value="USD">USD</option>
              <option value="CRC">CRC</option>
            </select>
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bu-creditlimit">Límite de crédito</label>
            <input
              id="bu-creditlimit"
              type="number"
              className="aur-input aur-input--num"
              min="0"
              step="0.01"
              value={form.creditLimit}
              onChange={update('creditLimit')}
            />
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="bu-notes">Notas</label>
            <textarea
              id="bu-notes"
              className="aur-textarea"
              rows="3"
              value={form.notes}
              onChange={update('notes')}
            />
          </div>
        </div>
      </section>

      <div className="aur-form-actions">
        <button type="button" className="aur-btn-text" onClick={onCancel} disabled={saving}>
          <FiX /> Cancelar
        </button>
        <button type="submit" className="aur-btn-pill" disabled={saving}>
          <FiSave /> {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}

export default BuyerForm;
