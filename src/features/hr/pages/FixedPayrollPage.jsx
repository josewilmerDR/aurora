import { useState } from 'react';
import FixedPayroll from './FixedPayroll';
import FixedPayrollHistory from './FixedPayrollHistory';
import '../styles/payroll-hub.css';

// Hub de planilla fija con tabs Editor / Historial. Ambos paneles permanecen
// montados (display:none) para preservar el estado del editor cuando el
// usuario consulta el historial y regresa.
export default function FixedPayrollPage() {
  const [tab, setTab] = useState('editor');
  return (
    <div className="payroll-hub">
      <nav className="payroll-hub-tabs" role="tablist" aria-label="Planilla salario fijo">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'editor'}
          className={`payroll-hub-tab${tab === 'editor' ? ' is-active' : ''}`}
          onClick={() => setTab('editor')}
        >
          Editor
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'historial'}
          className={`payroll-hub-tab${tab === 'historial' ? ' is-active' : ''}`}
          onClick={() => setTab('historial')}
        >
          Historial
        </button>
      </nav>
      <div className="payroll-hub-body">
        <div className={`payroll-hub-pane${tab === 'editor' ? '' : ' is-hidden'}`}>
          <FixedPayroll />
        </div>
        <div className={`payroll-hub-pane${tab === 'historial' ? '' : ' is-hidden'}`}>
          <FixedPayrollHistory />
        </div>
      </div>
    </div>
  );
}
