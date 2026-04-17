import { FiEdit, FiTrash2, FiPhone, FiMail } from 'react-icons/fi';

const PAYMENT_LABELS = { contado: 'Contado', credito: 'Crédito' };

function BuyerRow({ buyer, onEdit, onDelete }) {
  const { id, name, taxId, phone, email, paymentType, creditDays, currency, status } = buyer;
  return (
    <div className="lote-card">
      <div className="lote-card-main">
        <div className="item-main-text">
          <strong>{name}</strong>
          {status === 'inactivo' && <span className="finance-pill finance-pill--inactive">Inactivo</span>}
        </div>
        <div className="info-list">
          {taxId && <span>{taxId}</span>}
          {phone && <span><FiPhone size={12} /> {phone}</span>}
          {email && <span><FiMail size={12} /> {email}</span>}
          <span>{PAYMENT_LABELS[paymentType] || paymentType}{paymentType === 'credito' ? ` · ${creditDays}d` : ''}</span>
          <span>{currency}</span>
        </div>
      </div>
      <div className="lote-card-actions">
        <button className="btn-icon" title="Editar" onClick={() => onEdit(buyer)}><FiEdit /></button>
        <button className="btn-icon btn-icon-danger" title="Eliminar" onClick={() => onDelete(id)}><FiTrash2 /></button>
      </div>
    </div>
  );
}

export default BuyerRow;
