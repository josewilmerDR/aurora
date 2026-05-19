import AuroraModal from '../../../components/AuroraModal';
import CashBalanceForm from './CashBalanceForm';

function CashBalanceModal({ onSubmit, onCancel, saving }) {
  return (
    <AuroraModal
      title="Registrar saldo"
      size="lg"
      scrollable
      preventClose={saving}
      onClose={onCancel}
    >
      <CashBalanceForm onSubmit={onSubmit} onCancel={onCancel} saving={saving} />
    </AuroraModal>
  );
}

export default CashBalanceModal;
