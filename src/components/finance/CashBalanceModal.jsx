import { useEffect } from 'react';
import { FiX } from 'react-icons/fi';
import CashBalanceForm from './CashBalanceForm';
import '../ConfirmModal.css';

function CashBalanceModal({ onSubmit, onCancel, saving }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  return (
    <div className="modal-overlay" onClick={() => !saving && onCancel?.()}>
      <div
        className="modal-card"
        style={{ maxWidth: 620, width: '92%', padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Registrar saldo</h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            title="Cerrar"
            style={{ background: 'transparent', border: 'none', color: 'var(--aurora-light)', opacity: 0.7, cursor: 'pointer', padding: 4, borderRadius: 4 }}
          >
            <FiX size={18} />
          </button>
        </div>

        <CashBalanceForm
          onSubmit={onSubmit}
          onCancel={onCancel}
          saving={saving}
        />
      </div>
    </div>
  );
}

export default CashBalanceModal;
