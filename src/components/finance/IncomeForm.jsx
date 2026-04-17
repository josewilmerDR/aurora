import { useState, useEffect, useMemo } from 'react';
import { FiSave, FiX } from 'react-icons/fi';
import BuyerSelector from './BuyerSelector';

const EMPTY = {
  id: null,
  date: new Date().toISOString().slice(0, 10),
  loteId: '',
  loteNombre: '',
  grupo: '',
  cosechaRegistroId: '',
  despachoId: '',
  buyerId: '',
  quantity: '',
  unit: 'kg',
  unitPrice: '',
  totalAmount: '',
  currency: 'USD',
  collectionStatus: 'pendiente',
  expectedCollectionDate: '',
  actualCollectionDate: '',
  note: '',
};

function IncomeForm({ initial, onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => { setForm(initial ? { ...EMPTY, ...initial } : EMPTY); }, [initial]);

  const update = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  // Si el usuario no escribió un totalAmount manual, lo mostramos calculado.
  const computedTotal = useMemo(() => {
    const q = Number(form.quantity);
    const p = Number(form.unitPrice);
    if (!Number.isFinite(q) || !Number.isFinite(p)) return '';
    return (q * p).toFixed(2);
  }, [form.quantity, form.unitPrice]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...form };
    // Convertimos números y limpiamos strings vacíos para que el validador
    // backend aplique sus defaults correctamente.
    payload.quantity = Number(payload.quantity);
    payload.unitPrice = Number(payload.unitPrice);
    if (payload.totalAmount === '' || payload.totalAmount === null) {
      delete payload.totalAmount;
    } else {
      payload.totalAmount = Number(payload.totalAmount);
    }
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
          <BuyerSelector value={form.buyerId} onChange={(v) => setForm(p => ({ ...p, buyerId: v }))} required />
        </div>
        <div className="finance-field">
          <label>Cantidad *</label>
          <input type="number" min="0" step="0.01" value={form.quantity} onChange={update('quantity')} required />
        </div>
        <div className="finance-field">
          <label>Unidad</label>
          <input type="text" value={form.unit} onChange={update('unit')} />
        </div>
        <div className="finance-field">
          <label>Precio unitario *</label>
          <input type="number" min="0" step="0.0001" value={form.unitPrice} onChange={update('unitPrice')} required />
        </div>
        <div className="finance-field">
          <label>Monto total (opcional)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.totalAmount}
            onChange={update('totalAmount')}
            placeholder={computedTotal ? `Calculado: ${computedTotal}` : ''}
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
