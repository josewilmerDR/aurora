import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiTarget, FiCheckCircle, FiCircle, FiArrowRight, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

/**
 * SetupChecklist — guía progresiva para usuarios nuevos del dashboard.
 *
 * El audit observó que los 4 widgets vacíos lucen como "etiquetas y links
 * sueltos". Para usuarios nuevos (cero data en finance) este checklist
 * convierte ese vacío en una tarea concreta: "completá estos 3 pasos para
 * que el dashboard se llene".
 *
 * Comportamiento:
 *   - Al montar consulta 3 endpoints (saldo de caja, presupuestos, ingresos).
 *   - Si los 3 tienen data → marca la finca como "setup done" en localStorage
 *     y no vuelve a renderizar (ni a fetchear) en futuras visitas.
 *   - Si alguno está vacío → renderiza el checklist con progreso visual
 *     (✔ verde para los pasos completados, círculo gris para los pendientes).
 *   - El usuario puede cerrar manualmente con ✕; se persiste en localStorage
 *     bajo `aurora_finance_checklist_dismissed=1`.
 *
 * Por qué localStorage y no cuenta atrás de servidor: el checklist es un
 * onboarding opcional, no un dato de negocio. Persistir por navegador es
 * suficiente y evita un endpoint nuevo.
 */

const STORAGE_KEY_DONE = 'aurora_finance_setup_done';
const STORAGE_KEY_DISMISSED = 'aurora_finance_checklist_dismissed';

function readFlag(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key) {
  try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
}

export default function SetupChecklist() {
  const apiFetch = useApiFetch();
  const [status, setStatus] = useState(null);
  // Inicializa hidden=true si ya completó el setup o si el usuario cerró
  // el checklist manualmente. Evita el render flicker mientras se hace fetch.
  const [hidden, setHidden] = useState(
    () => readFlag(STORAGE_KEY_DONE) || readFlag(STORAGE_KEY_DISMISSED)
  );

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    Promise.all([
      apiFetch('/api/treasury/projection?weeks=1')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      apiFetch('/api/budgets')
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      apiFetch('/api/income')
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ]).then(([proj, budgets, income]) => {
      if (cancelled) return;
      const hasBalance = !!proj?.startingBalanceSource;
      const hasBudget = Array.isArray(budgets) && budgets.length > 0;
      const hasIncome = Array.isArray(income) && income.length > 0;

      if (hasBalance && hasBudget && hasIncome) {
        // Setup completo: marcamos como hecho y no rendereamos. La próxima
        // vez que el dashboard monte, hidden arrancará en true sin fetchear.
        writeFlag(STORAGE_KEY_DONE);
        setHidden(true);
        return;
      }
      setStatus({ hasBalance, hasBudget, hasIncome });
    });
    return () => { cancelled = true; };
  }, [apiFetch, hidden]);

  if (hidden || !status) return null;

  const { hasBalance, hasBudget, hasIncome } = status;
  const completed = [hasBalance, hasBudget, hasIncome].filter(Boolean).length;

  const dismiss = () => {
    writeFlag(STORAGE_KEY_DISMISSED);
    setHidden(true);
  };

  const steps = [
    {
      done: hasBalance,
      label: 'Registrá tu saldo de caja inicial',
      hint: 'Sin saldo, no podemos proyectar tu liquidez.',
      to: '/finance/tesoreria',
    },
    {
      done: hasBudget,
      label: 'Definí los presupuestos del mes',
      hint: 'Te permite comparar gasto real contra meta.',
      to: '/finance/presupuestos',
    },
    {
      done: hasIncome,
      label: 'Registrá tus primeros ingresos',
      hint: 'Necesario para calcular rentabilidad por lote.',
      to: '/finance/ingresos',
    },
  ];

  return (
    <section className="fin-setup-checklist" aria-label="Cómo empezar con el módulo financiero">
      <header className="fin-setup-checklist-header">
        <span className="fin-setup-checklist-badge"><FiTarget size={16} /></span>
        <div className="fin-setup-checklist-title-block">
          <h3 className="fin-setup-checklist-title">Cómo empezar</h3>
          <p className="fin-setup-checklist-progress">
            {completed}/3 pasos completados — el dashboard cobra vida cuando termines.
          </p>
        </div>
        <button
          type="button"
          className="fin-setup-checklist-close aur-touch-target"
          onClick={dismiss}
          title="Cerrar guía (no volverá a aparecer)"
          aria-label="Cerrar guía de inicio"
        >
          <FiX size={14} />
        </button>
      </header>

      <ul className="fin-setup-checklist-list">
        {steps.map((step) => (
          <li
            key={step.to}
            className={`fin-setup-checklist-item${step.done ? ' is-done' : ''}`}
          >
            <span className="fin-setup-checklist-item-icon">
              {step.done
                ? <FiCheckCircle size={16} aria-label="Completado" />
                : <FiCircle size={16} aria-label="Pendiente" />}
            </span>
            <div className="fin-setup-checklist-item-text">
              <span className="fin-setup-checklist-item-label">{step.label}</span>
              <span className="fin-setup-checklist-item-hint">{step.hint}</span>
            </div>
            {!step.done && (
              <Link
                to={step.to}
                className="aur-btn-text fin-setup-checklist-item-cta"
              >
                Ir <FiArrowRight size={12} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
