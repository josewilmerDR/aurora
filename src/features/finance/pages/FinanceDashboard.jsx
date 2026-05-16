import { FiDollarSign } from 'react-icons/fi';
import AuroraSectionIntro from '../../../components/ui/AuroraSectionIntro';
import CashWidget from '../components/dashboard/CashWidget';
import BudgetWidget from '../components/dashboard/BudgetWidget';
import RoiWidget from '../components/dashboard/RoiWidget';
import CommitmentsWidget from '../components/dashboard/CommitmentsWidget';
import SetupChecklist from '../components/dashboard/SetupChecklist';
import '../styles/finance-dashboard.css';

// Etiqueta del mes actual capitalizada en español: "Mayo 2026".
function currentMonthLabel() {
  const now = new Date();
  const raw = now.toLocaleDateString('es-CR', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// Dashboard financiero ejecutivo — 4 widgets autocontenidos. El rol mínimo
// (administrador) lo aplica la ruta en App.jsx vía RoleRoute, no aquí.
function FinanceDashboard() {
  return (
    <div className="page-container">
      <div className="page-header fin-dashboard-header">
        <h2><FiDollarSign /> Finanzas — Dashboard Ejecutivo</h2>
        <p className="fin-dashboard-subtitle">{currentMonthLabel()} · vista en tiempo real</p>
      </div>

      <AuroraSectionIntro>
        Visión rápida de tus finanzas en 4 mediciones: saldo de caja, ejecución
        del presupuesto, rentabilidad por lote y compromisos próximos. Cada
        tarjeta enlaza al detalle correspondiente.
      </AuroraSectionIntro>

      <SetupChecklist />

      {/* Sección 1: Liquidez. Caja es la métrica primaria del dashboard
          financiero — recibe 2/3 del ancho mientras Compromisos toma el
          1/3 restante. En mobile (<960px) ambos colapsan a una columna.
          El modificador --liquidity ancla los delays de stagger (C2). */}
      <section className="fin-dashboard-section fin-dashboard-section--liquidity">
        <p className="fin-dashboard-section-label">Liquidez y caja</p>
        <div className="fin-dashboard-row fin-dashboard-row--liquidity">
          <CashWidget />
          <CommitmentsWidget />
        </div>
      </section>

      {/* Sección 2: Rentabilidad. Presupuesto y ROI tienen el mismo peso
          (ambas son lecturas comparables del desempeño del período). */}
      <section className="fin-dashboard-section fin-dashboard-section--profit">
        <p className="fin-dashboard-section-label">Rentabilidad del período</p>
        <div className="fin-dashboard-row fin-dashboard-row--profit">
          <BudgetWidget />
          <RoiWidget />
        </div>
      </section>
    </div>
  );
}

export default FinanceDashboard;
