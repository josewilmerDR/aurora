import './ConfirmModal.css';

function ConfirmModal({ title, message, onConfirm, onCancel, loading = false, confirmLabel = 'Sí, eliminar', loadingLabel = 'Procesando…' }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button className="btn-modal-cancel" onClick={onCancel} disabled={loading}>
            Cancelar
          </button>
          <button className="btn-modal-confirm" onClick={onConfirm} disabled={loading}>
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
