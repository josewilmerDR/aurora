import { FiEdit, FiTrash2 } from 'react-icons/fi';

const CATEGORY_LABELS = {
  combustible:      'Combustible',
  depreciacion:     'Depreciación',
  planilla_directa: 'Planilla directa',
  planilla_fija:    'Planilla fija',
  insumos:          'Insumos',
  mantenimiento:    'Mantenimiento',
  administrativo:   'Administrativo',
  otro:             'Otro',
};

function fmtAmount(n, currency) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${currency || 'USD'} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function BudgetRow({ budget, onEdit, onDelete }) {
  const { id, period, category, subcategory, assignedAmount, currency, loteId, notes } = budget;
  return (
    <div className="lote-card">
      <div className="lote-card-main">
        <div className="item-main-text">
          <strong>{CATEGORY_LABELS[category] || category}</strong>
          {subcategory && <span style={{ opacity: 0.7 }}> · {subcategory}</span>}
        </div>
        <div className="info-list">
          <span>Período: {period}</span>
          <span className="finance-amount">{fmtAmount(assignedAmount, currency)}</span>
          {loteId && <span>Lote: {loteId}</span>}
          {notes && <span style={{ opacity: 0.7 }}>{notes}</span>}
        </div>
      </div>
      <div className="lote-card-actions">
        <button className="btn-icon" title="Editar" onClick={() => onEdit(budget)}><FiEdit /></button>
        <button className="btn-icon btn-icon-danger" title="Eliminar" onClick={() => onDelete(id)}><FiTrash2 /></button>
      </div>
    </div>
  );
}

export default BudgetRow;
