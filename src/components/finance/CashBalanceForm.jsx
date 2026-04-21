import { useState } from 'react';
import { FiSave, FiX } from 'react-icons/fi';

const MAX_AMOUNT = 1e12;
const MAX_NOTE = 500;
const MAX_FX = 100000;

const makeEmpty = () => ({
  dateAsOf: new Date().toISOString().slice(0, 10),
  amount: '',
  currency: 'CRC',
  exchangeRateToCRC: '',
  source: 'manual',
  note: '',
});

function CashBalanceForm({ onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(makeEmpty);
  const needsFx = form.currency !== 'CRC';

  const update = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...form, amount: Number(form.amount) };
    payload.exchangeRateToCRC = needsFx ? Number(form.exchangeRateToCRC) : 1;
    onSubmit(payload);
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
          <input
            type="number"
            step="0.01"
            min={-MAX_AMOUNT}
            max={MAX_AMOUNT}
            value={form.amount}
            onChange={update('amount')}
            required
          />
        </div>
        <div className="finance-field">
          <label>Moneda</label>
          <select value={form.currency} onChange={update('currency')}>
            <option value="CRC">CRC</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="finance-field">
          <label>Fuente</label>
          <select value={form.source} onChange={update('source')}>
            <option value="manual">Manual</option>
            <option value="bank">Bancario</option>
          </select>
        </div>
        {needsFx && (
          <div className="finance-field finance-field-full">
            <label>Tipo de cambio a CRC *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={MAX_FX}
              value={form.exchangeRateToCRC}
              onChange={update('exchangeRateToCRC')}
              placeholder="ej. 520.00"
              required
            />
            <small style={{ fontSize: 11, color: 'var(--aurora-light)', opacity: 0.6 }}>
              1 {form.currency} = ? CRC. Se usa para convertir a la moneda funcional.
            </small>
          </div>
        )}
        <div className="finance-field finance-field-full">
          <label>Nota</label>
          <textarea rows="2" maxLength={MAX_NOTE} value={form.note} onChange={update('note')} />
        </div>
      </div>
      <div className="lote-form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          <FiX /> Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <FiSave /> {saving ? 'Guardando…' : 'Guardar saldo'}
        </button>
      </div>
    </form>
  );
}

export default CashBalanceForm;
