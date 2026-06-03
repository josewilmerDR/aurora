import UnitPayroll from './UnitPayroll';
import UnitPayrollHistory from './UnitPayrollHistory';
import PayrollHub from '../components/PayrollHub';

// Hub de planilla por unidad. Comparte la mecánica de tabs (ARIA, lazy-mount,
// sync de URL ?tab=) con la planilla fija vía PayrollHub.
export default function UnitPayrollPage() {
  return (
    <PayrollHub
      ariaLabel="Planilla por unidad"
      heading="Planilla por unidad"
      idBase="payroll-unidad"
      editor={<UnitPayroll />}
      history={<UnitPayrollHistory />}
    />
  );
}
