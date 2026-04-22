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
    <form className="lote-form-card" onSubmit={handleSubmit}>
      <div className="finance-form-grid">
        <div className="finance-field">
          <label>Fecha *</label>
          <input type="date" value={form.date} onChange={update('date')} required />
        </div>
        <div className="finance-field">
          <label>Comprador *</label>
          <BuyerSelector value={form.buyerId} onChange={handleBuyerChange} required />
        </div>
        <div className="finance-field finance-field-full">
          <label>Despachos de cosecha (opcional)</label>
          <DispatchesSelect
            buyerId={form.buyerId}
            selected={form.despachoIds}
            onChange={handleDispatchesChange}
            excludeIncomeId={form.id}
          />
        </div>
        <div className="finance-field">
          <label>Cantidad *{hasDispatches ? ' (suma de despachos)' : ''}</label>
          <input
            type="number" min="0" step="0.01"
            value={form.quantity}
            onChange={update('quantity')}
            required
            readOnly={hasDispatches}
          />
        </div>
        <div className="finance-field">
          <label>Unidad</label>
          <input
            type="text"
            value={form.unit}
            onChange={update('unit')}
            readOnly={hasDispatches}
          />
        </div>
        <div className="finance-field">
          <label>Precio unitario *</label>
          <input type="number" min="0" step="0.0001" value={form.unitPrice} onChange={update('unitPrice')} required />
        </div>
        <div className="finance-field">
          <label>Monto total (opcional)</label>
          <input
            type="number" min="0" step="0.01"
            value={form.totalAmount}
            onChange={update('totalAmount')}
            placeholder={computedTotal ? `Calculado: ${computedTotal}` : ''}
          />
        </div>
        <div className="finance-field">
          <label>Moneda</label>
          <select value={form.currency} onChange={update('currency')}>
            <option value="CRC">CRC</option>
            <option value="USD">USD</option>
          </select>
        </div>
        {needsFx && (
          <div className="finance-field">
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
          </div>
        )}
        <div className="finance-field">
          <label>Estado de cobro</label>
          <select value={form.collectionStatus} onChange={update('collectionStatus')}>
            <option value="pendiente">Pendiente</option>
            <option value="cobrado">Cobrado</option>
            <option value="anulado">Anulado</option>
          </select>
        </div>
        <div className="finance-field">
          <label>Fecha esperada de cobro</label>
          <input type="date" value={form.expectedCollectionDate} onChange={update('expectedCollectionDate')} />
        </div>
        {form.collectionStatus === 'cobrado' && (
          <div className="finance-field">
            <label>Fecha real de cobro *</label>
            <input type="date" value={form.actualCollectionDate} onChange={update('actualCollectionDate')} required />
          </div>
        )}
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
          <FiSave /> {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}

export default IncomeForm;
