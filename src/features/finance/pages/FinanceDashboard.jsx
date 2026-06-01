import { FiDollarSign } from 'react-icons/fi';
import PageHeader from '../../../components/PageHeader';
import AuroraSectionIntro from '../../../components/ui/AuroraSectionIntro';
import CashWidget from '../components/dashboard/CashWidget';
import BudgetWidget from '../components/dashboard/BudgetWidget';
import RoiWidget from '../components/dashboard/RoiWidget';
import CommitmentsWidget from '../components/dashboard/CommitmentsWidget';
import SetupChecklist from '../components/dashboard/SetupChecklist';
import { useFinanceResource } from '../hooks/useFinanceResource';
import { currentMonthLabel } from '../lib/format';
import '../styles/finance-dashboard.css';

// Dashboard financiero ejecutivo — 4 widgets autocontenidos. El rol mínimo
// (administrador) lo aplica la ruta en App.jsx vía RoleRoute, no aquí.
function FinanceDashboard() {
  // La proyección de tesorería (12 semanas) se fetchea UNA vez acá y se
  // comparte entre Caja y Compromisos. Antes cada widget llamaba al mismo
  // endpoint pesado por separado (12s + 4s); ahora Compromisos recorta las
  // primeras 4 semanas del mismo response en cliente.
  const projection = useFinanceResource('/api/treasury/projection?weeks=12', {
    errorMessage: 'No se pudo cargar la información de tesorería.',
  });

  return (
    <div className="page-container">
      <PageHeader
        level={2}
        icon={<FiDollarSign />}
        title="Finanzas — Dashboard Ejecutivo"
        subtitle={`${currentMonthLabel()} · vista en tiempo real`}
      />

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
      <section
        className="fin-dashboard-section fin-dashboard-section--liquidity"
        aria-labelledby="fin-section-liquidity"
      >
        <p className="fin-dashboard-section-label" id="fin-section-liquidity">Liquidez y caja</p>
        <div className="fin-dashboard-row fin-dashboard-row--liquidity">
          <CashWidget {...projection} />
          <CommitmentsWidget {...projection} />
        </div>
      </section>

      {/* Sección 2: Rentabilidad. Presupuesto y ROI tienen el mismo peso
          (ambas son lecturas comparables del desempeño del período). */}
      <section
        className="fin-dashboard-section fin-dashboard-section--profit"
        aria-labelledby="fin-section-profit"
      >
        <p className="fin-dashboard-section-label" id="fin-section-profit">Rentabilidad del período</p>
        <div className="fin-dashboard-row fin-dashboard-row--profit">
          <BudgetWidget />
          <RoiWidget />
        </div>
      </section>
    </div>
  );
}

export default FinanceDashboard;
