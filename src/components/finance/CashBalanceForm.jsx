import { useState } from 'react';
import { FiSave, FiX } from 'react-icons/fi';

const EMPTY = {
  dateAsOf: new Date().toISOString().slice(0, 10),
  amount: '',
  currency: 'USD',
  source: 'manual',
  note: '',
};

function CashBalanceForm({ onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(EMPTY);

  const update = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ ...form, amount: Number(form.amount) });
  };

  return (
    <form className="lote-form-card" onSubmit={handleSubmit}>
      <div className="finance-form-grid">
        <div className="finance-field">
          <label>Fecha del saldo *</label>
          <input type="date" value={form.dateAsOf} onChange={update('dateAsOf')} required />
        </div>
        <div className="finance-field">
          <label>Saldo *</label>
          <input type="number" step="0.01" value={form.amount} onChange={update('amount')} required />
        </div>
        <div className="finance-field">
          <label>Moneda</label>
          <select value={form.currency} onChange={update('currency')}>
            <option value="USD">USD</option>
            <option value="CRC">CRC</option>
          </select>
        </div>
        <div className="finance-field">
          <label>Fuente</label>
          <select value={form.source} onChange={update('source')}>
            <option value="manual">Manual</option>
            <option value="bank">Bancario</option>
          </select>
        </div>
        <div className="finance-field finance-field-full">
          <label>Nota</label>
          <textarea rows="2" value={form.note} onChange={update('note')} />
        </div>
      </div>
      <div className="lote-form-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          <FiX /> Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          <FiSave /> {saving ? 'Guardando…' : 'Guardar saldo'}
        </button>
      </div>
    </form>
  );
}

export default CashBalanceForm;
