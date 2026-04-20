import { useState, useEffect } from 'react';
import { FiSave, FiX } from 'react-icons/fi';
import { formatPeriod, parsePeriod } from '../../lib/periodFormat';

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
  const [periodError, setPeriodError] = useState('');

  useEffect(() => {
    // El input muestra formato en español (ej. "Abril 2026", "T2 2026").
    // Al enviar se convierte a canónico para el backend.
    if (initial) setForm({ ...EMPTY, ...initial, period: formatPeriod(initial.period) });
    else setForm({ ...EMPTY, period: formatPeriod(defaultPeriod || '') });
    setPeriodError('');
  }, [initial, defaultPeriod]);

  const update = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const canonical = parsePeriod(form.period);
    if (!canonical) {
      setPeriodError('Formato no reconocido. Ejemplos: "Abril 2026", "T2 2026", "2026".');
      return;
    }
    setPeriodError('');
    const payload = {
      ...form,
      period: canonical,
      assignedAmount: Number(form.assignedAmount),
    };
    onSubmit(payload);
  };

  return (
    <form className="form-card" onSubmit={handleSubmit}>
      <h2>{initial ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h2>
      <div className="finance-form-grid">
        <div className="finance-field">
          <label>Período *</label>
          <input
            type="text"
            value={form.period}
            onChange={(e) => { setForm(prev => ({ ...prev, period: e.target.value })); if (periodError) setPeriodError(''); }}
            placeholder="Abril 2026 | T2 2026 | 2026"
            title='Ejemplos: "Abril 2026", "T2 2026", "2026"'
            required
          />
          {periodError && (
            <span style={{ color: '#ff8080', fontSize: 12 }}>{periodError}</span>
          )}
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
          <input type="text" maxLength={150} value={form.subcategory} onChange={update('subcategory')} />
        </div>
        <div className="finance-field">
          <label>Monto asignado *</label>
          <input
            type="number"
            min="0"
            max="1000000000000"
            step="0.01"
            value={form.assignedAmount}
            onChange={update('assignedAmount')}
            required
          />
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
          <input type="text" maxLength={128} value={form.loteId} onChange={update('loteId')} />
        </div>
        <div className="finance-field finance-field-full">
          <label>Notas</label>
          <textarea rows="2" maxLength={1000} value={form.notes} onChange={update('notes')} />
        </div>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          <FiX /> Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <FiSave /> {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}

export default BudgetForm;
