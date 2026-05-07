import { FiCheck } from 'react-icons/fi';
import '../styles/payroll-step-indicator.css';

// Indicador visual de los 3 pasos del flujo de planilla fija. Es
// puramente presentacional: el padre calcula `currentStep` (1, 2 o 3)
// desde su propio estado y este componente sólo lo dibuja. No controla
// navegación — las transiciones siguen siendo las del flujo existente
// (Previsualizar avanza a paso 2, Guardar abre modal de paso 3).
const STEPS = [
  { n: 1, label: 'Período',   hint: 'Configurá fechas inicio y fin del período de pago.' },
  { n: 2, label: 'Empleados', hint: 'Revisá días, salario y deducciones de cada empleado.' },
  { n: 3, label: 'Guardar',   hint: 'Confirmá totales y guardá la planilla.' },
];

export default function PayrollStepIndicator({ currentStep }) {
  return (
    <div className="payroll-steps" role="navigation" aria-label="Pasos de la planilla">
      <ol className="payroll-steps-list">
        {STEPS.map((step, idx) => {
          const isCompleted = step.n < currentStep;
          const isActive    = step.n === currentStep;
          const isPending   = step.n > currentStep;
          const stateClass = isActive ? 'is-active' : isCompleted ? 'is-completed' : 'is-pending';
          return (
            <li key={step.n} className={`payroll-step ${stateClass}`}>
              <div className="payroll-step-marker" aria-hidden="true">
                {isCompleted ? <FiCheck size={14} /> : step.n}
              </div>
              <div className="payroll-step-text">
                <div className="payroll-step-label">{step.label}</div>
                {isActive && <div className="payroll-step-hint">{step.hint}</div>}
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`payroll-step-connector${isCompleted ? ' is-completed' : ''}`} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
