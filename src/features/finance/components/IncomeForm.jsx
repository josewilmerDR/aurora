import { useState, useEffect, useMemo } from 'react';
import { FiSave, FiX } from 'react-icons/fi';
import BuyerSelector from './BuyerSelector';
import DispatchesSelect from './DispatchesSelect';

const MAX_FX = 100000;

const EMPTY = {
  id: null,
  date: new Date().toISOString().slice(0, 10),
  loteId: '',
  loteNombre: '',
  grupo: '',
  cosechaRegistroId: '',
  despachoId: '',
  despachoIds: [],
  buyerId: '',
  quantity: '',
  unit: 'kg',
  unitPrice: '',
  totalAmount: '',
  currency: 'CRC',
  exchangeRateToCRC: '',
  collectionStatus: 'pendiente',
  expectedCollectionDate: '',
  actualCollectionDate: '',
  note: '',
};

function IncomeForm({ initial, onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(EMPTY);
  const needsFx = form.currency !== 'CRC';
  const hasDispatches = Array.isArray(form.despachoIds) && form.despachoIds.length > 0;

  useEffect(() => {
    if (!initial) { setForm(EMPTY); return; }
    setForm({ ...EMPTY, ...initial, despachoIds: Array.isArray(initial.despachoIds) ? initial.despachoIds : [] });
  }, [initial]);

  const update = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleDispatchesChange = (dispatches) => {
    setForm(prev => {
      const qtySum = dispatches.reduce((acc, d) => acc + (Number(d.cantidad) || 0), 0);
      const unit = dispatches[0]?.unidad || prev.unit;
      return {
        ...prev,
        despachoIds: dispatches,
        quantity: dispatches.length > 0 && qtySum > 0 ? String(qtySum) : prev.quantity,
        unit: dispatches.length > 0 ? unit : prev.unit,
      };
    });
  };

  const handleBuyerChange = (buyerId) => {
    setForm(prev => {
      const changed = prev.buyerId !== buyerId;
      return {
        ...prev,
        buyerId,
        // Al cambiar de comprador, los despachos ya no aplican.
        despachoIds: changed ? [] : prev.despachoIds,
      };
    });
  };

  // Si el usuario no escribió un totalAmount manual, mostramos el calculado.
  const computedTotal = useMemo(() => {
    const q = Number(form.quantity);
    const p = Number(form.unitPrice);
    if (!Number.isFinite(q) || !Number.isFinite(p)) return '';
    return (q * p).toFixed(2);
  }, [form.quantity, form.unitPrice]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...form };
    payload.quantity = Number(payload.quantity);
    payload.unitPrice = Number(payload.unitPrice);
    if (payload.totalAmount === '' || payload.totalAmount === null) {
      delete payload.totalAmount;
    } else {
      payload.totalAmount = Number(payload.totalAmount);
    }
    payload.exchangeRateToCRC = needsFx ? Number(form.exchangeRateToCRC) : 1;
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num">01</span>
          <h3 className="aur-section-title">Origen</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="if-date">Fecha</label>
            <input
              id="if-date"
              type="date"
              className="aur-input"
              value={form.date}
              onChange={update('date')}
              required
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="if-buyer">Comprador</label>
            <BuyerSelector
              value={form.buyerId}
              onChange={handleBuyerChange}
              required
              className="aur-select"
            />
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label">Despachos de cosecha (opcional)</label>
            <DispatchesSelect
              buyerId={form.buyerId}
              selected={form.despachoIds}
              onChange={handleDispatchesChange}
              excludeIncomeId={form.id}
            />
          </div>
        </div>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num">02</span>
          <h3 className="aur-section-title">Cantidad y precio</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="if-qty">
              Cantidad{hasDispatches ? ' (suma de despachos)' : ''}
            </label>
            <input
              id="if-qty"
              type="number"
              className={`aur-input aur-input--num${hasDispatches ? ' aur-input--readonly' : ''}`}
              min="0"
              step="0.01"
              value={form.quantity}
              onChange={update('quantity')}
              required
              readOnly={hasDispatches}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="if-unit">Unidad</label>
            <input
              id="if-unit"
              type="text"
              className={`aur-input${hasDispatches ? ' aur-input--readonly' : ''}`}
              value={form.unit}
              onChange={update('unit')}
              readOnly={hasDispatches}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="if-price">Precio unitario</label>
            <input
              id="if-price"
              type="number"
              className="aur-input aur-input--num"
              min="0"
              step="0.0001"
              value={form.unitPrice}
              onChange={update('unitPrice')}
              required
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="if-total">Monto total (opcional)</label>
            <input
              id="if-total"
              type="number"
              className="aur-input aur-input--num"
              min="0"
              step="0.01"
              value={form.totalAmount}
              onChange={update('totalAmount')}
              placeholder={computedTotal ? `Calculado: ${computedTotal}` : ''}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="if-currency">Moneda</label>
            <select
              id="if-currency"
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
              <label className="aur-row-label" htmlFor="if-fx">Tipo de cambio a CRC</label>
              <input
                id="if-fx"
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
          <span className="aur-section-num">03</span>
          <h3 className="aur-section-title">Cobro</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="if-status">Estado de cobro</label>
            <select
              id="if-status"
              className="aur-select"
              value={form.collectionStatus}
              onChange={update('collectionStatus')}
            >
              <option value="pendiente">Pendiente</option>
              <option value="cobrado">Cobrado</option>
              <option value="anulado">Anulado</option>
            </select>
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="if-expected">Fecha esperada de cobro</label>
            <input
              id="if-expected"
              type="date"
              className="aur-input"
              value={form.expectedCollectionDate}
              onChange={update('expectedCollectionDate')}
            />
          </div>
          {form.collectionStatus === 'cobrado' && (
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="if-actual">Fecha real de cobro</label>
              <input
                id="if-actual"
                type="date"
                className="aur-input"
                value={form.actualCollectionDate}
                onChange={update('actualCollectionDate')}
                required
              />
            </div>
          )}
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="if-note">Nota</label>
            <textarea
              id="if-note"
              className="aur-textarea"
              rows="2"
              value={form.note}
              onChange={update('note')}
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

export default IncomeForm;
