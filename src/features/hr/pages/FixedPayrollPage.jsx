import FixedPayroll from './FixedPayroll';
import FixedPayrollHistory from './FixedPayrollHistory';
import PayrollHub from '../components/PayrollHub';

// Hub de planilla fija. La mecánica de tabs (ARIA, lazy-mount, sync de URL)
// vive en PayrollHub, compartida con la planilla por unidad. El segundo tab es
// una consulta read-only "Por empleado"; la gestión (aprobar/pagar/eliminar)
// vive en el Editor.
export default function FixedPayrollPage() {
  return (
    <PayrollHub
      ariaLabel="Planilla salario fijo"
      heading="Planilla de salario fijo"
      idBase="payroll-fijo"
      historyLabel="Por empleado"
      editor={<FixedPayroll />}
      history={<FixedPayrollHistory />}
    />
  );
}
