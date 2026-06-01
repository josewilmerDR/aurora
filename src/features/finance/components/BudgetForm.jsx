import { useState, useEffect, useMemo } from 'react';
import { FiSave, FiX } from 'react-icons/fi';
import { formatPeriod } from '../../../lib/periodFormat';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { BUDGET_CATEGORY_OPTIONS as CATEGORY_OPTIONS } from '../lib/budgetCategories';

const MAX_FX = 100000;

const EMPTY = {
  id: null,
  period: '',
  category: 'combustible',
  subcategory: '',
  loteId: '',
  loteNombre: '',
  assignedAmount: '',
  currency: 'CRC',
  exchangeRateToCRC: '',
  notes: '',
};

// Campos que viajan al backend. Evita reenviar campos calculados/del servidor
// (executedAmount, createdAt, fincaId…) que vienen en `initial` al editar.
const EDITABLE_FIELDS = [
  'period', 'category', 'subcategory', 'loteId', 'loteNombre',
  'assignedAmount', 'currency', 'exchangeRateToCRC', 'notes',
];

function BudgetForm({ initial, defaultPeriod, periodOptions = [], onSubmit, onCancel, saving }) {
  const apiFetch = useApiFetch();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [lotes, setLotes] = useState([]);
  const needsFx = form.currency !== 'CRC';

  useEffect(() => {
    if (initial) setForm({ ...EMPTY, ...initial });
    else setForm({ ...EMPTY, period: defaultPeriod || '' });
    setErrors({});
  }, [initial, defaultPeriod]);

  // Cargamos los lotes de la finca para el selector (asignación opcional).
  useEffect(() => {
    const controller = new AbortController();
    apiFetch('/api/lotes', { signal: controller.signal })
      .then(r => r.json())
      .then(data => setLotes(Array.isArray(data) ? data : []))
      .catch(err => { if (err?.name !== 'AbortError') setLotes([]); });
    return () => controller.abort();
  }, [apiFetch]);

  const loteOptions = useMemo(
    () => lotes.map(l => ({
      id: l.id,
      label: l.nombreLote && l.nombreLote !== l.codigoLote
        ? `${l.codigoLote} — ${l.nombreLote}`
        : (l.codigoLote || l.nombreLote || l.id),
    })),
    [lotes]
  );

  const update = (field) => (e) => {
    const { value } = e.target;
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const handleLoteChange = (e) => {
    const loteId = e.target.value;
    const match = lotes.find(l => l.id === loteId);
    setForm(prev => ({
      ...prev,
      loteId,
      loteNombre: match ? (match.codigoLote || match.nombreLote || '') : '',
    }));
  };

  // Validación inline: el form usa noValidate (igual que el resto del módulo),
  // así que validamos a mano y mostramos errores por campo en vez de mandar
  // un payload inválido y depender del error genérico del backend.
  const validate = () => {
    const next = {};
    if (!form.period) next.period = 'Seleccioná un período.';
    const amount = Number(form.assignedAmount);
    if (form.assignedAmount === '' || !Number.isFinite(amount) || amount <= 0) {
      next.assignedAmount = 'Ingresá un monto mayor que 0.';
    }
    if (needsFx) {
      const fx = Number(form.exchangeRateToCRC);
      if (form.exchangeRateToCRC === '' || !Number.isFinite(fx) || fx < 0.01) {
        next.exchangeRateToCRC = 'Ingresá el tipo de cambio (mayor que 0).';
      }
    }
    return next;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      // Foco al primer campo con error para que el usuario lo encuentre.
      const firstId = `bf-${found.period ? 'period' : found.assignedAmount ? 'amount' : 'fx'}`;
      document.getElementById(firstId)?.focus();
      return;
    }
    const payload = { id: form.id || undefined };
    for (const key of EDITABLE_FIELDS) payload[key] = form[key];
    payload.assignedAmount = Number(form.assignedAmount);
    payload.exchangeRateToCRC = needsFx ? Number(form.exchangeRateToCRC) : 1;
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
              className={`aur-select${errors.period ? ' aur-input--error' : ''}`}
              value={form.period}
              onChange={update('period')}
              aria-invalid={errors.period ? 'true' : undefined}
              aria-describedby={errors.period ? 'bf-period-err' : undefined}
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
          {errors.period && <p id="bf-period-err" className="aur-field-error">{errors.period}</p>}
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="bf-category">Categoría</label>
            <select
              id="bf-category"
              className="aur-select"
              value={form.category}
              onChange={update('category')}
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
              className={`aur-input aur-input--num${errors.assignedAmount ? ' aur-input--error' : ''}`}
              min="0"
              max="1000000000000"
              step="0.01"
              value={form.assignedAmount}
              onChange={update('assignedAmount')}
              aria-invalid={errors.assignedAmount ? 'true' : undefined}
              aria-describedby={errors.assignedAmount ? 'bf-amount-err' : undefined}
            />
          </div>
          {errors.assignedAmount && <p id="bf-amount-err" className="aur-field-error">{errors.assignedAmount}</p>}
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
            <>
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="bf-fx">Tipo de cambio a CRC</label>
                <input
                  id="bf-fx"
                  type="number"
                  className={`aur-input aur-input--num${errors.exchangeRateToCRC ? ' aur-input--error' : ''}`}
                  step="0.01"
                  min="0.01"
                  max={MAX_FX}
                  value={form.exchangeRateToCRC}
                  onChange={update('exchangeRateToCRC')}
                  placeholder="ej. 520.00"
                  aria-invalid={errors.exchangeRateToCRC ? 'true' : undefined}
                  aria-describedby={errors.exchangeRateToCRC ? 'bf-fx-err' : undefined}
                />
              </div>
              {errors.exchangeRateToCRC && <p id="bf-fx-err" className="aur-field-error">{errors.exchangeRateToCRC}</p>}
            </>
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
            <select
              id="bf-lote"
              className="aur-select"
              value={form.loteId}
              onChange={handleLoteChange}
            >
              <option value="">Sin lote</option>
              {/* Si el lote guardado ya no existe en la lista, lo conservamos
                  como opción para no perder la asignación al editar. */}
              {form.loteId && !loteOptions.find(o => o.id === form.loteId) && (
                <option value={form.loteId}>{form.loteNombre || form.loteId}</option>
              )}
              {loteOptions.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
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
