import { useState, useRef, useEffect } from 'react';
import { FiBriefcase, FiShield, FiChevronDown } from 'react-icons/fi';
import PageHeader from '../../../components/PageHeader';
import AuroraSectionIntro from '../../../components/ui/AuroraSectionIntro';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import FinancialProfileWidget from '../components/dashboard/FinancialProfileWidget';
import CreditCatalogWidget from '../components/dashboard/CreditCatalogWidget';
import EligibilityWidget from '../components/dashboard/EligibilityWidget';
import DebtSimulationsWidget from '../components/dashboard/DebtSimulationsWidget';
import FinancingSetupChecklist from '../components/dashboard/FinancingSetupChecklist';
import '../styles/finance-dashboard.css';
import '../styles/financing.css';

// Badge de "Política Nivel 1" como popover controlado. Antes era un <details>
// nativo: sin chevron (parecía un pill estático, no algo expandible) y no
// cerraba con ESC ni al clickear afuera (el panel quedaba flotando sobre el
// contenido). Ahora es un botón con aria-expanded + caret animado, que cierra
// con ESC (useEscapeClose) y con click-away.
function FinancingPolicyBadge() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // ESC cierra el popover innermost. Pasamos null cuando está cerrado para no
  // ocupar el tope del stack de ESC inútilmente.
  useEscapeClose(open ? () => setOpen(false) : null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className="fin-policy-details" ref={ref}>
      <button
        type="button"
        className="fin-policy-summary aur-touch-target"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <FiShield size={13} aria-hidden="true" />
        <span>Política Nivel 1</span>
        <FiChevronDown
          size={13}
          aria-hidden="true"
          className={`fin-policy-caret${open ? ' is-open' : ''}`}
        />
      </button>
      {open && (
        <div className="fin-policy-content" role="region" aria-label="Política Nivel 1">
          <strong>Nivel 1 por política:</strong> este dominio solo produce
          recomendaciones. Ninguna acción autónoma firma, aplica o acepta
          crédito.
        </div>
      )}
    </div>
  );
}

// Dashboard de Financiamiento Externo — Fase 5.5.
//
// 4 widgets autocontenidos agrupados en dos secciones temáticas que reflejan
// el flujo de decisión: primero tu situación y las opciones disponibles, luego
// el análisis (¿calificás? ¿conviene?). La política de Nivel 1 (el dominio
// nunca ejecuta acciones autónomas) se enforza en backend; acá solo se comunica.
function FinancingDashboard() {
  return (
    <div className="page-container">
      <PageHeader
        level={2}
        icon={<FiBriefcase />}
        title="Financiamiento"
        actions={<FinancingPolicyBadge />}
      />

      <AuroraSectionIntro>
        Evaluá opciones de crédito externo para tu finca: revisá tu perfil
        financiero, registrá ofertas de bancos o cooperativas, analizá tu
        elegibilidad y simulá el impacto antes de firmar.
      </AuroraSectionIntro>

      <FinancingSetupChecklist />

      {/* Sección 1: punto de partida — tu perfil financiero y las ofertas
          concretas disponibles. */}
      <section className="fin-dashboard-section fin-dashboard-section--fin-profile">
        <p className="fin-dashboard-section-label">Tu perfil y opciones</p>
        <div className="fin-dashboard-row fin-dashboard-row--pair">
          <FinancialProfileWidget />
          <CreditCatalogWidget />
        </div>
      </section>

      {/* Sección 2: análisis de decisión — calificación y simulación de impacto. */}
      <section className="fin-dashboard-section fin-dashboard-section--fin-analysis">
        <p className="fin-dashboard-section-label">Análisis de decisión</p>
        <div className="fin-dashboard-row fin-dashboard-row--pair">
          <EligibilityWidget />
          <DebtSimulationsWidget />
        </div>
      </section>
    </div>
  );
}

export default FinancingDashboard;
