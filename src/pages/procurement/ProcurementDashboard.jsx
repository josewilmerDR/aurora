import { FiShoppingCart } from 'react-icons/fi';
import StockGapsWidget from '../../components/procurement/dashboard/StockGapsWidget';
import SupplierRankingWidget from '../../components/procurement/dashboard/SupplierRankingWidget';
import PendingActionsWidget from '../../components/procurement/dashboard/PendingActionsWidget';
import RfqsWidget from '../../components/procurement/dashboard/RfqsWidget';
import './ProcurementDashboard.css';

// Procurement dashboard — 4 autonomous widgets. Role is enforced upstream
// by App.jsx via RoleRoute; this component does not re-check.
function ProcurementDashboard() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiShoppingCart /> Abastecimiento</h2>
      </div>

      <p className="finance-empty" style={{ padding: 0, textAlign: 'left', marginBottom: 16 }}>
        Vista consolidada de brechas de stock, ranking de proveedores, aprobaciones pendientes y
        cotizaciones en curso. Los widgets se actualizan al abrir la página.
      </p>

      <div className="fin-dashboard-grid">
        <StockGapsWidget />
        <SupplierRankingWidget />
        <PendingActionsWidget />
        <RfqsWidget />
      </div>
    </div>
  );
}

export default ProcurementDashboard;
