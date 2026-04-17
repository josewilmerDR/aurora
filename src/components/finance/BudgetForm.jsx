import { useState, useEffect } from 'react';
import { FiSave, FiX } from 'react-icons/fi';

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

const EMPTY = {
  id: null,
  period: '',
  category: 'combustible',
  subcategory: '',
  loteId: '',
  grupoId: '',
  assignedAmount: '',
  currency: 'USD',
  notes: '',
};

function BudgetForm({ initial, defaultPeriod, onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (initial) setForm({ ...EMPTY, ...initial });
    else setForm({ ...EMPTY, period: defaultPeriod || '' });
  }, [initial, defaultPeriod]);

  const update = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...form, assignedAmount: Number(form.assignedAmount) };
    onSubmit(payload);
  };

  return (
    <form className="lote-form-card" onSubmit={handleSubmit}>
      <div className="finance-form-grid">
        <div className="finance-field">
          <label>Período *</label>
          <input
            type="text"
            value={form.period}
            onChange={update('period')}
            placeholder="2026-04 | 2026-Q2 | 2026"
            required
          />
        </div>
        <div className="finance-field">
          <label>Categoría *</label>
          <select value={form.category} onChange={update('category')} required>
            {CATEGORY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="finance-field">
          <label>Subcategoría</label>
          <input type="text" value={form.subcategory} onChange={update('subcategory')} />
        </div>
        <div className="finance-field">
          <label>Monto asignado *</label>
          <input type="number" min="0" step="0.01" value={form.assignedAmount} onChange={update('assignedAmount')} required />
        </div>
        <div className="finance-field">
          <label>Moneda</label>
          <select value={form.currency} onChange={update('currency')}>
            <option value="USD">USD</option>
            <option value="CRC">CRC</option>
          </select>
        </div>
        <div className="finance-field">
          <label>Lote (opcional)</label>
          <input type="text" value={form.loteId} onChange={update('loteId')} />
        </div>
        <div className="finance-field finance-field-full">
          <label>Notas</label>
          <textarea rows="2" value={form.notes} onChange={update('notes')} />
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

export default BudgetForm;
