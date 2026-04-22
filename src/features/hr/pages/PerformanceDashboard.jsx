import { FiUsers } from 'react-icons/fi';
import PerformanceScoreTable from '../components/dashboard/PerformanceScoreTable';
import ProductivityHeatmap from '../components/dashboard/ProductivityHeatmap';
import WorkloadProjectionChart from '../components/dashboard/WorkloadProjectionChart';
import HiringRecommendationsCard from '../components/dashboard/HiringRecommendationsCard';
import PerformanceAlertsCard from '../components/dashboard/PerformanceAlertsCard';
import AccuracyWidget from '../components/dashboard/AccuracyWidget';
import '../styles/performance-dashboard.css';

// Supervisor+ dashboard — 5 widgets. Role gating is applied upstream
// via RoleRoute in App.jsx (path '/hr/performance' → 'supervisor').
// This page makes no role decisions of its own.
function PerformanceDashboard() {
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
        <AccuracyWidget />
      </div>
    </div>
  );
}

export default PerformanceDashboard;
