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
    <form onSubmit={handleSubmit} noValidate>
      <div className="aur-list">
        <div className="aur-row">
          <label className="aur-row-label" htmlFor="cb-date">Fecha del saldo</label>
          <input
            id="cb-date"
            type="date"
            className="aur-input"
            value={form.dateAsOf}
            onChange={update('dateAsOf')}
            required
          />
        </div>
        <div className="aur-row">
          <label className="aur-row-label" htmlFor="cb-amount">Saldo</label>
          <input
            id="cb-amount"
            type="number"
            className="aur-input aur-input--num"
            step="0.01"
            min={-MAX_AMOUNT}
            max={MAX_AMOUNT}
            value={form.amount}
            onChange={update('amount')}
            required
          />
        </div>
        <div className="aur-row">
          <label className="aur-row-label" htmlFor="cb-currency">Moneda</label>
          <select
            id="cb-currency"
            className="aur-select"
            value={form.currency}
            onChange={update('currency')}
          >
            <option value="CRC">CRC</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="aur-row">
          <label className="aur-row-label" htmlFor="cb-source">Fuente</label>
          <select
            id="cb-source"
            className="aur-select"
            value={form.source}
            onChange={update('source')}
          >
            <option value="manual">Manual</option>
            <option value="bank">Bancario</option>
          </select>
        </div>
        {needsFx && (
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="cb-fx">Tipo de cambio a CRC</label>
            <input
              id="cb-fx"
              type="number"
              className="aur-input aur-input--num"
              step="0.01"
              min="0.01"
              max={MAX_FX}
              value={form.exchangeRateToCRC}
              onChange={update('exchangeRateToCRC')}
              placeholder="ej. 520.00"
              required
            />
            <span className="aur-field-hint">
              1 {form.currency} = ? CRC. Se usa para convertir a la moneda funcional.
            </span>
          </div>
        )}
        <div className="aur-row aur-row--multiline">
          <label className="aur-row-label" htmlFor="cb-note">Nota</label>
          <textarea
            id="cb-note"
            className="aur-textarea"
            rows="2"
            maxLength={MAX_NOTE}
            value={form.note}
            onChange={update('note')}
          />
        </div>
      </div>

      <div className="aur-form-actions">
        <button type="button" className="aur-btn-text" onClick={onCancel} disabled={saving}>
          <FiX /> Cancelar
        </button>
        <button type="submit" className="aur-btn-pill" disabled={saving}>
          <FiSave /> {saving ? 'Guardando…' : 'Guardar saldo'}
        </button>
      </div>
    </form>
  );
}

export default CashBalanceForm;
