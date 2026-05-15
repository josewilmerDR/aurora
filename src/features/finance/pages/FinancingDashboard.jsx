import { FiBriefcase, FiShield } from 'react-icons/fi';
import AuroraSectionIntro from '../../../components/ui/AuroraSectionIntro';
import FinancialProfileWidget from '../components/dashboard/FinancialProfileWidget';
import CreditCatalogWidget from '../components/dashboard/CreditCatalogWidget';
import EligibilityWidget from '../components/dashboard/EligibilityWidget';
import DebtSimulationsWidget from '../components/dashboard/DebtSimulationsWidget';
import '../styles/finance-dashboard.css';
import '../styles/financing.css';

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
        {/* Antes este disclaimer ocupaba un banner de ~1/3 del viewport.
            Ahora vive en un <details> compacto al lado del título: el
            usuario casual lee el resumen y los administradores expanden
            la política completa cuando la necesitan (audit UX). */}
        <details className="fin-policy-details">
          <summary className="fin-policy-summary">
            <FiShield size={13} aria-hidden="true" />
            <span>Política Nivel 1</span>
          </summary>
          <div className="fin-policy-content">
            <strong>Nivel 1 por política:</strong> este dominio solo produce
            recomendaciones. Ninguna acción autónoma firma, aplica o acepta
            crédito.
          </div>
        </details>
      </div>

      <AuroraSectionIntro>
        Evaluá opciones de crédito externo para tu finca: revisá tu perfil
        financiero, registrá ofertas de bancos o cooperativas, analizá tu
        elegibilidad y simulá el impacto antes de firmar.
      </AuroraSectionIntro>

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
