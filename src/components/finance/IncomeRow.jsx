import { FiEdit, FiTrash2, FiCalendar } from 'react-icons/fi';
import { formatMoney } from '../../lib/formatMoney';

const STATUS_PILL = {
  pendiente: { label: 'Pendiente', cls: 'finance-pill--pending' },
  cobrado:   { label: 'Cobrado',   cls: 'finance-pill--paid' },
  anulado:   { label: 'Anulado',   cls: 'finance-pill--void' },
};

const formatAmount = (n, currency) => formatMoney(n, currency);

function IncomeRow({ record, onEdit, onDelete }) {
  const { id, date, buyerName, quantity, unit, unitPrice, totalAmount, currency, collectionStatus, loteNombre, expectedCollectionDate } = record;
  const pill = STATUS_PILL[collectionStatus] || STATUS_PILL.pendiente;

  return (
    <div className="lote-card">
      <div className="lote-card-main">
        <div className="item-main-text">
          <strong>{buyerName || '—'}</strong>
          <span className={`finance-pill ${pill.cls}`}>{pill.label}</span>
        </div>
        <div className="info-list">
          <span><FiCalendar size={12} /> {date}</span>
          {loteNombre && <span>{loteNombre}</span>}
          <span>{quantity} {unit || ''} × {formatAmount(unitPrice, currency)}</span>
          <span className="finance-amount">{formatAmount(totalAmount, currency)}</span>
          {expectedCollectionDate && collectionStatus === 'pendiente' && (
            <span>Cobro esperado: {expectedCollectionDate}</span>
          )}
        </div>
      </div>
      <div className="lote-card-actions">
        <button className="btn-icon" title="Editar" onClick={() => onEdit(record)}><FiEdit /></button>
        <button className="btn-icon btn-icon-danger" title="Eliminar" onClick={() => onDelete(id)}><FiTrash2 /></button>
      </div>
    </div>
  );
}

export default IncomeRow;
