import { FiDollarSign } from 'react-icons/fi';
import CashWidget from '../components/dashboard/CashWidget';
import BudgetWidget from '../components/dashboard/BudgetWidget';
import RoiWidget from '../components/dashboard/RoiWidget';
import CommitmentsWidget from '../components/dashboard/CommitmentsWidget';
import '../styles/finance-dashboard.css';

// Dashboard financiero ejecutivo — 4 widgets autocontenidos. El rol mínimo
// (administrador) lo aplica la ruta en App.jsx vía RoleRoute, no aquí.
function FinanceDashboard() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiDollarSign /> Finanzas — Dashboard Ejecutivo</h2>
      </div>

      <p className="fin-dashboard-intro">
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
