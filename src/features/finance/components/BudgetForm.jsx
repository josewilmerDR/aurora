import { useState, useEffect } from 'react';
import { FiSave, FiX } from 'react-icons/fi';
import { formatPeriod } from '../../../lib/periodFormat';

// Keys iguales a las categorías en functions/lib/finance/categories.js.
const CATEGORY_OPTIONS = [
  { value: 'combustible',      label: 'Combustible' },
  { value: 'depreciacion',     label: 'Depreciación' },
  { value: 'planilla_directa', label: 'Planilla directa' },
  { value: 'planilla_fija',    label: 'Planilla fija' },
  { value: 'insumos',          label: 'Insumos' },
  { value: 'mantenimiento',    label: 'Mantenimiento' },
  { value: 'administrativo',   label: 'Administrativo' },
  { value: 'otro',             label: 'Otro' },
];

const MAX_FX = 100000;

const EMPTY = {
  id: null,
  period: '',
  category: 'combustible',
  subcategory: '',
  loteId: '',
  grupoId: '',
  assignedAmount: '',
  currency: 'CRC',
  exchangeRateToCRC: '',
  notes: '',
};

function BudgetForm({ initial, defaultPeriod, periodOptions = [], onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(EMPTY);
  const needsFx = form.currency !== 'CRC';

  useEffect(() => {
    if (initial) setForm({ ...EMPTY, ...initial });
    else setForm({ ...EMPTY, period: defaultPeriod || '' });
  }, [initial, defaultPeriod]);

  const update = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      assignedAmount: Number(form.assignedAmount),
      exchangeRateToCRC: needsFx ? Number(form.exchangeRateToCRC) : 1,
    };
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <section className="aur-section">
        <div className="aur-section-header">
          <h3 className="aur-section-title">{initial ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bf-period">Período</label>
            <select
              id="bf-period"
              className="aur-select"
              value={form.period}
              onChange={update('period')}
              required
            >
              <option value="" disabled>Seleccionar período…</option>
              {form.period && !periodOptions.find(o => o.value === form.period) && (
                <option value={form.period}>{formatPeriod(form.period) || form.period}</option>
              )}
              {periodOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bf-category">Categoría</label>
            <select
              id="bf-category"
              className="aur-select"
              value={form.category}
              onChange={update('category')}
              required
            >
              {CATEGORY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bf-subcategory">Subcategoría</label>
            <input
              id="bf-subcategory"
              type="text"
              className="aur-input"
              maxLength={150}
              value={form.subcategory}
              onChange={update('subcategory')}
            />
          </div>
        </div>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <h3 className="aur-section-title">Monto y moneda</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bf-amount">Monto asignado</label>
            <input
              id="bf-amount"
              type="number"
              className="aur-input aur-input--num"
              min="0"
              max="1000000000000"
              step="0.01"
              value={form.assignedAmount}
              onChange={update('assignedAmount')}
              required
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bf-currency">Moneda</label>
            <select
              id="bf-currency"
              className="aur-select"
              value={form.currency}
              onChange={update('currency')}
            >
              <option value="CRC">CRC</option>
              <option value="USD">USD</option>
            </select>
          </div>
          {needsFx && (
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="bf-fx">Tipo de cambio a CRC</label>
              <input
                id="bf-fx"
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
            </div>
          )}
        </div>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <h3 className="aur-section-title">Asignación y notas</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bf-lote">Lote (opcional)</label>
            <input
              id="bf-lote"
              type="text"
              className="aur-input"
              maxLength={128}
              value={form.loteId}
              onChange={update('loteId')}
            />
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="bf-notes">Notas</label>
            <textarea
              id="bf-notes"
              className="aur-textarea"
              rows="2"
              maxLength={1000}
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

export default BudgetForm;
