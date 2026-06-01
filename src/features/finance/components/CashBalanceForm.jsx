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
  const [errors, setErrors] = useState({});
  const needsFx = form.currency !== 'CRC';

  const update = (field) => (e) => {
    const { value } = e.target;
    setForm(prev => ({ ...prev, [field]: value }));
    // Limpiamos el error del campo en cuanto el usuario lo edita.
    setErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const validate = () => {
    const next = {};
    const amount = Number(form.amount);
    // `noValidate` desactiva la validación nativa, así que el `required` no
    // frena nada: validamos a mano para no registrar un saldo de ₡0 fantasma.
    if (form.amount === '' || !Number.isFinite(amount)) {
      next.amount = 'Ingresá un saldo.';
    }
    if (needsFx) {
      const fx = Number(form.exchangeRateToCRC);
      if (form.exchangeRateToCRC === '' || !Number.isFinite(fx) || fx <= 0) {
        next.exchangeRateToCRC = 'Ingresá el tipo de cambio.';
      }
    }
    return next;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const next = validate();
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
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
            className={`aur-input aur-input--num${errors.amount ? ' aur-input--error' : ''}`}
            step="0.01"
            min={-MAX_AMOUNT}
            max={MAX_AMOUNT}
            value={form.amount}
            onChange={update('amount')}
            aria-invalid={!!errors.amount}
            aria-describedby={errors.amount ? 'cb-amount-error' : undefined}
            required
          />
          {errors.amount && (
            <span id="cb-amount-error" className="aur-field-error">{errors.amount}</span>
          )}
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
              className={`aur-input aur-input--num${errors.exchangeRateToCRC ? ' aur-input--error' : ''}`}
              step="0.01"
              min="0.01"
              max={MAX_FX}
              value={form.exchangeRateToCRC}
              onChange={update('exchangeRateToCRC')}
              placeholder="ej. 520.00"
              aria-invalid={!!errors.exchangeRateToCRC}
              aria-describedby={errors.exchangeRateToCRC ? 'cb-fx-error' : 'cb-fx-hint'}
              required
            />
            {errors.exchangeRateToCRC && (
              <span id="cb-fx-error" className="aur-field-error">{errors.exchangeRateToCRC}</span>
            )}
            <span id="cb-fx-hint" className="aur-field-hint">
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
