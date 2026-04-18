import { FiDollarSign } from 'react-icons/fi';
import CashWidget from '../../components/finance/dashboard/CashWidget';
import BudgetWidget from '../../components/finance/dashboard/BudgetWidget';
import RoiWidget from '../../components/finance/dashboard/RoiWidget';
import CommitmentsWidget from '../../components/finance/dashboard/CommitmentsWidget';
import './FinanceDashboard.css';

// Dashboard financiero ejecutivo — 4 widgets autocontenidos. El rol mínimo
// (administrador) lo aplica la ruta en App.jsx vía RoleRoute, no aquí.
function FinanceDashboard() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiDollarSign /> Finanzas — Dashboard Ejecutivo</h2>
      </div>

      <p className="finance-empty" style={{ padding: 0, textAlign: 'left', marginBottom: 16 }}>
        Vista consolidada de caja, presupuesto, rentabilidad y compromisos próximos. Los widgets se
        actualizan cada vez que abres la página.
      </p>

      <div className="fin-dashboard-grid">
        <CashWidget />
        <BudgetWidget />
        <RoiWidget />
        <CommitmentsWidget />
      </div>
    </div>
  );
}

export default FinanceDashboard;
