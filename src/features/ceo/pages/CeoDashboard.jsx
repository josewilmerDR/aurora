import { FiCpu, FiShield } from 'react-icons/fi';
import OrchestratorStatusWidget from '../components/OrchestratorStatusWidget';
import TrustScoreWidget from '../components/TrustScoreWidget';
import KpiAccuracyWidget from '../components/KpiAccuracyWidget';
import ChainHistoryWidget from '../components/ChainHistoryWidget';
import DynamicGuardrailsWidget from '../components/DynamicGuardrailsWidget';
import '../styles/ceo-dashboard.css';

// CEO Dashboard — Fase 6.5.
//
// Observabilidad completa del meta-agente de Aurora. 5 widgets independientes
// cada uno tocando un endpoint distinto:
//   - OrchestratorStatusWidget (Fase 6.1): último plan + urgencias detectadas
//   - TrustScoreWidget (Fase 6.3): score 0..1 por dominio
//   - KpiAccuracyWidget (Fase 6.2): hit-rate por actionType × ventana
//   - ChainHistoryWidget (Fase 6.4): cadenas recientes + rollback status
//   - DynamicGuardrailsWidget (Fase 6.3): propuestas pendientes + corridor

function CeoDashboard() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiCpu /> CEO Dashboard</h2>
      </div>

      <div className="fin-policy-banner ceo-banner">
        <FiShield size={14} />
        <span>
          <strong>Vista del meta-agente:</strong> orquestador, trust por dominio, hit-rate
          de decisiones, historial de cadenas cross-domain y propuestas de guardrails
          pendientes. Los caps arquitectónicos (HR forbidden N3, financing N1-only)
          siguen enforzados en backend; esta página solo los refleja.
        </span>
      </div>

      <div className="fin-dashboard-grid ceo-grid">
        <OrchestratorStatusWidget />
        <TrustScoreWidget />
        <KpiAccuracyWidget />
        <ChainHistoryWidget />
        <DynamicGuardrailsWidget />
      </div>
    </div>
  );
}

export default CeoDashboard;
