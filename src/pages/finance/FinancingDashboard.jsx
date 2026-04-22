import { FiBriefcase, FiShield } from 'react-icons/fi';
import FinancialProfileWidget from '../../components/finance/dashboard/FinancialProfileWidget';
import CreditCatalogWidget from '../../components/finance/dashboard/CreditCatalogWidget';
import EligibilityWidget from '../../components/finance/dashboard/EligibilityWidget';
import DebtSimulationsWidget from '../../components/finance/dashboard/DebtSimulationsWidget';
import './FinanceDashboard.css';
import './financing.css';

// Dashboard de Financiamiento Externo — Fase 5.5.
//
// Composición de 4 widgets autocontenidos:
//   - Perfil financiero + snapshots
//   - Catálogo de crédito
//   - Análisis de elegibilidad reciente
//   - Simulaciones de deuda (ROI Monte Carlo)
//
// La política de Nivel 1 (el dominio nunca ejecuta acciones autónomas) se
// enforza a nivel backend. Acá solo la comunicamos al usuario.
function FinancingDashboard() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiBriefcase /> Financiamiento</h2>
      </div>

      <div className="fin-policy-banner">
        <FiShield size={14} />
        <span>
          <strong>Nivel 1 por política:</strong> este dominio solo produce recomendaciones.
          Ninguna acción autónoma firma, aplica o acepta crédito.
        </span>
      </div>

      <div className="fin-dashboard-grid">
        <FinancialProfileWidget />
        <CreditCatalogWidget />
        <EligibilityWidget />
        <DebtSimulationsWidget />
      </div>
    </div>
  );
}

export default FinancingDashboard;
