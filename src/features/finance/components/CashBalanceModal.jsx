import { useEffect } from 'react';
import { FiX } from 'react-icons/fi';
import CashBalanceForm from './CashBalanceForm';

function CashBalanceModal({ onSubmit, onCancel, saving }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  return (
    <div
      className="aur-modal-backdrop"
      onPointerDown={() => !saving && onCancel?.()}
    >
      <div
        className="aur-modal aur-modal--lg"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="aur-modal-header">
          <span className="aur-modal-title">Registrar saldo</span>
          <button
            type="button"
            className="aur-modal-close aur-btn-text"
            onClick={onCancel}
            disabled={saving}
            title="Cerrar"
            aria-label="Cerrar"
          >
            <FiX size={18} />
          </button>
        </div>

        <div className="aur-modal-content">
          <CashBalanceForm
            onSubmit={onSubmit}
            onCancel={onCancel}
            saving={saving}
          />
        </div>
      </div>
    </div>
  );
}

export default CashBalanceModal;
