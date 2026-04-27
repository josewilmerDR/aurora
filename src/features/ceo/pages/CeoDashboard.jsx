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
        <h2><FiCpu /> Resumen del Copilot</h2>
      </div>

      <div className="aur-banner aur-banner--info">
        <FiShield size={14} />
        <span>
          <strong>¿Cómo está trabajando el Copilot por usted?</strong> Aquí ve qué revisa
          cada cierto tiempo, qué tan acertadas han sido sus decisiones, qué tareas
          encadenó y qué ajustes le sugiere a sus reglas. Las protecciones de seguridad
          de su finca siempre siguen activas: hay decisiones que el Copilot nunca toma
          solo, sin importar el nivel que usted le dé.
        </span>
      </div>

      <div className="ceo-grid">
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
