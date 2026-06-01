import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiTarget, FiCheckCircle, FiCircle, FiArrowRight, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

/**
 * FinancingSetupChecklist — onboarding del dashboard de Financiamiento.
 *
 * Gemelo de SetupChecklist (dashboard financiero), adaptado al flujo de
 * financiamiento externo, que es SECUENCIAL: necesitás un snapshot del perfil
 * antes de poder analizar elegibilidad, y ofertas registradas antes de simular.
 * Un usuario nuevo veía 4 cards vacías sin saber por dónde empezar; este
 * checklist ordena los 3 pasos y se autodesaparece cuando están completos.
 *
 * Reusa las clases .fin-setup-checklist* (genéricas) y el mismo mecanismo de
 * persistencia por-finca en localStorage que SetupChecklist.
 */

const ACTIVE_FINCA_KEY = 'aurora_active_finca';
const STORAGE_KEY_DONE = 'aurora_financing_setup_done';
const STORAGE_KEY_DISMISSED = 'aurora_financing_checklist_dismissed';

function fincaSuffix() {
  try {
    const finca = localStorage.getItem(ACTIVE_FINCA_KEY);
    return finca ? `_${finca}` : '';
  } catch { return ''; }
}
function readFlag(key) {
  try { return localStorage.getItem(key + fincaSuffix()) === '1'; } catch { return false; }
}
function writeFlag(key) {
  try { localStorage.setItem(key + fincaSuffix(), '1'); } catch { /* ignore */ }
}

const asArray = (r) => (r.ok ? r.json() : []);
const len = (x) => (Array.isArray(x) ? x.length : 0);

export default function FinancingSetupChecklist() {
  const apiFetch = useApiFetch();
  const [status, setStatus] = useState(null);
  const [hidden, setHidden] = useState(
    () => readFlag(STORAGE_KEY_DONE) || readFlag(STORAGE_KEY_DISMISSED)
  );

  useEffect(() => {
    if (hidden) return undefined;
    let cancelled = false;
    Promise.all([
      apiFetch('/api/financing/profile/snapshots').then(asArray).catch(() => []),
      apiFetch('/api/financing/credit-products').then(asArray).catch(() => []),
      apiFetch('/api/financing/debt-simulations').then(asArray).catch(() => []),
    ]).then(([snapshots, offers, sims]) => {
      if (cancelled) return;
      const hasSnapshot = len(snapshots) > 0;
      const hasOffer = len(offers) > 0;
      const hasSim = len(sims) > 0;

      if (hasSnapshot && hasOffer && hasSim) {
        writeFlag(STORAGE_KEY_DONE);
        setHidden(true);
        return;
      }
      setStatus({ hasSnapshot, hasOffer, hasSim });
    });
    return () => { cancelled = true; };
  }, [apiFetch, hidden]);

  if (hidden || !status) return null;

  const { hasSnapshot, hasOffer, hasSim } = status;
  const completed = [hasSnapshot, hasOffer, hasSim].filter(Boolean).length;

  const dismiss = () => {
    writeFlag(STORAGE_KEY_DISMISSED);
    setHidden(true);
  };

  const steps = [
    {
      key: 'snapshot',
      done: hasSnapshot,
      label: 'Generá tu perfil financiero',
      hint: 'Un snapshot inmutable de activos, deuda y caja — base de todo el análisis.',
      to: '/finance/financing',
    },
    {
      key: 'offer',
      done: hasOffer,
      label: 'Registrá las ofertas de crédito que recibiste',
      hint: 'Cargá las cotizaciones de bancos o cooperativas para compararlas.',
      to: '/finance/financing/ofertas',
    },
    {
      key: 'sim',
      done: hasSim,
      label: 'Corré una simulación de deuda',
      hint: 'Monte Carlo del impacto de una oferta sobre tu margen antes de firmar.',
      to: '/finance/financing/simulaciones',
    },
  ];

  return (
    <section className="fin-setup-checklist" aria-label="Cómo empezar con financiamiento externo">
      <header className="fin-setup-checklist-header">
        <span className="fin-setup-checklist-badge"><FiTarget size={16} /></span>
        <div className="fin-setup-checklist-title-block">
          <h3 className="fin-setup-checklist-title">Cómo empezar</h3>
          <p className="fin-setup-checklist-progress">
            {completed}/3 pasos completados — seguí el orden para evaluar crédito con datos.
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
            key={step.key}
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
                className="aur-btn-text fin-setup-checklist-item-cta aur-touch-target"
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
