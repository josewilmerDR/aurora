import { FiUsers } from 'react-icons/fi';
import PerformanceScoreTable from '../../components/hr/dashboard/PerformanceScoreTable';
import ProductivityHeatmap from '../../components/hr/dashboard/ProductivityHeatmap';
import WorkloadProjectionChart from '../../components/hr/dashboard/WorkloadProjectionChart';
import HiringRecommendationsCard from '../../components/hr/dashboard/HiringRecommendationsCard';
import PerformanceAlertsCard from '../../components/hr/dashboard/PerformanceAlertsCard';
import './HrPerformanceDashboard.css';

// Supervisor+ dashboard — 5 widgets. Role gating is applied upstream
// via RoleRoute in App.jsx (path '/hr/performance' → 'supervisor').
// This page makes no role decisions of its own.
function HrPerformanceDashboard() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiUsers /> RR.HH. — Desempeño y proyección</h2>
      </div>

      <p className="hr-widget-sub" style={{ padding: 0, textAlign: 'left', marginBottom: 16 }}>
        Scores mensuales, matriz de productividad, proyección de carga, y recomendaciones del agente.
        Las recomendaciones siempre quedan como propuestas — el agente RR.HH. nunca ejecuta.
      </p>

      <div className="hr-dashboard-grid">
        <PerformanceScoreTable />
        <WorkloadProjectionChart />
        <ProductivityHeatmap />
        <HiringRecommendationsCard />
        <PerformanceAlertsCard />
      </div>
    </div>
  );
}

export default HrPerformanceDashboard;
