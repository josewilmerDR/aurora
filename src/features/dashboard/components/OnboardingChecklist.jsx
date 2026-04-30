import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiChevronLeft, FiChevronRight, FiCheck, FiX } from 'react-icons/fi';
import { useOnboardingProgress } from '../../../hooks/useOnboardingProgress';
import {
  isMinimized as readMinimized,
  setMinimized as writeMinimized,
  setCompletedSticky,
} from '../lib/onboardingState';

// En mobile mostramos 1 paso a la vez (el activo); en desktop 3.
// El breakpoint replica el del CSS para mantener la coherencia visual.
const MOBILE_QUERY = '(max-width: 640px)';

function useResponsiveViewSize() {
  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return 3;
    return window.matchMedia(MOBILE_QUERY).matches ? 1 : 3;
  });
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = (e) => setSize(e.matches ? 1 : 3);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return size;
}

// Anillo SVG para el badge minimizado.
function ProgressRing({ percent }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - percent / 100);
  return (
    <svg className="dash-onboarding-ring-svg" viewBox="0 0 56 56" aria-hidden="true">
      <circle className="dash-onboarding-ring-bg" cx="28" cy="28" r={r} />
      <circle
        className="dash-onboarding-ring-fg"
        cx="28" cy="28" r={r}
        strokeDasharray={c}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

// Una columna del carrusel: título arriba, hint solo si activo, dot+línea abajo.
// `prevDone` colorea la mitad izquierda; `step.completed` colorea la mitad derecha.
// `isGlobalFirst`/`isGlobalLast` ocultan la mitad correspondiente (no hay paso anterior/siguiente real).
function StepColumn({ step, isActive, isGlobalFirst, isGlobalLast, prevDone }) {
  const state = step.completed ? 'done' : isActive ? 'active' : 'future';
  const leftOn  = !isGlobalFirst && prevDone;
  const rightOn = !isGlobalLast && step.completed;

  const inner = (
    <>
      <div className="dash-onboarding-col-text">
        <div className={`dash-onboarding-col-title is-${state}`}>{step.label}</div>
        {isActive && step.description && (
          <div className="dash-onboarding-col-hint">{step.description}</div>
        )}
      </div>
      <div className="dash-onboarding-col-rail" aria-hidden="true">
        <span className={`dash-onboarding-rail-half is-left${leftOn ? ' is-on' : ''}${isGlobalFirst ? ' is-edge' : ''}`} />
        <span className={`dash-onboarding-col-dot is-${state}`}>
          {step.completed && <FiCheck size={11} />}
        </span>
        <span className={`dash-onboarding-rail-half is-right${rightOn ? ' is-on' : ''}${isGlobalLast ? ' is-edge' : ''}`} />
      </div>
    </>
  );

  // Paso "chat" no tiene ruta — abre el panel global de Aurora vía evento.
  if (!step.to) {
    return (
      <button
        type="button"
        className={`dash-onboarding-col is-${state}`}
        onClick={() => window.dispatchEvent(new CustomEvent('aurora:open'))}
      >
        {inner}
      </button>
    );
  }
  return (
    <Link to={step.to} className={`dash-onboarding-col is-${state}`}>
      {inner}
    </Link>
  );
}

function OnboardingChecklist({ uid }) {
  const enabled = Boolean(uid);
  const { steps, completedCount, total, percent, completedSticky, loading } =
    useOnboardingProgress({ enabled, uid });
  const viewSize = useResponsiveViewSize();

  const [minimized, setMinimizedState] = useState(() => (enabled ? readMinimized(uid) : false));
  // null → ventana derivada del paso activo. Number → el usuario navegó manualmente.
  const [windowOverride, setWindowOverride] = useState(null);

  // Una vez 11/11, sellar para siempre.
  useEffect(() => {
    if (!enabled) return;
    if (!loading && total > 0 && completedCount === total) {
      setCompletedSticky(uid);
    }
  }, [enabled, loading, total, completedCount, uid]);

  // Índice del primer paso incompleto (-1 si no hay).
  const activeIndex = useMemo(() => steps.findIndex(s => !s.completed), [steps]);

  if (!enabled) return null;
  if (loading) return null;
  if (completedSticky) return null;
  if (total > 0 && completedCount === total) return null;

  const minimize = () => { writeMinimized(uid, true); setMinimizedState(true); };
  const expand   = () => { writeMinimized(uid, false); setMinimizedState(false); };

  if (minimized) {
    return (
      <button
        type="button"
        className="dash-onboarding-badge"
        onClick={expand}
        title={`Onboarding · ${completedCount}/${total} pasos completados`}
        aria-label={`Abrir onboarding, ${completedCount} de ${total} pasos completados`}
      >
        <ProgressRing percent={percent} />
        <span className="dash-onboarding-badge-count">{completedCount}/{total}</span>
      </button>
    );
  }

  // Ventana visible. En desktop son 3 columnas centradas en el paso activo;
  // en mobile es 1, mostrando solo el activo (o el seleccionado por el usuario).
  const maxStart = Math.max(0, total - viewSize);
  const offsetToCenter = Math.floor(viewSize / 2);
  const derivedStart = Math.min(maxStart, Math.max(0, (activeIndex < 0 ? 0 : activeIndex - offsetToCenter)));
  const clampedOverride = windowOverride == null ? null : Math.min(maxStart, Math.max(0, windowOverride));
  const start = clampedOverride ?? derivedStart;
  const visible = steps.slice(start, start + viewSize);
  const canPrev = start > 0;
  const canNext = start < maxStart;

  const goPrev = () => canPrev && setWindowOverride(Math.max(0, start - 1));
  const goNext = () => canNext && setWindowOverride(Math.min(maxStart, start + 1));

  return (
    <section className="dash-onboarding-card" role="region" aria-label="Configuración inicial">
      <button
        type="button"
        className="dash-onboarding-minimize"
        onClick={minimize}
        title="Cerrar"
        aria-label="Cerrar onboarding"
      >
        <FiX size={16} />
      </button>

      <p className="dash-onboarding-hint">
        Haz este recorrido guiado por las funciones principales de Aurora para conocer mejor la plataforma
        {' '}
        <span className="dash-onboarding-hint-count">[{completedCount}/{total}]</span>
      </p>

      <div className="dash-onboarding-carousel">
        <button
          type="button"
          className="dash-onboarding-nav"
          onClick={goPrev}
          disabled={!canPrev}
          aria-label="Pasos anteriores"
        >
          <FiChevronLeft size={18} />
        </button>
        <div
          className="dash-onboarding-track"
          style={{ gridTemplateColumns: `repeat(${viewSize}, 1fr)` }}
        >
          {visible.map((step, i) => {
            const absoluteIndex = start + i;
            const prevStep = absoluteIndex > 0 ? steps[absoluteIndex - 1] : null;
            return (
              <StepColumn
                key={step.key}
                step={step}
                isActive={absoluteIndex === activeIndex}
                isGlobalFirst={absoluteIndex === 0}
                isGlobalLast={absoluteIndex === total - 1}
                prevDone={Boolean(prevStep?.completed)}
              />
            );
          })}
        </div>
        <button
          type="button"
          className="dash-onboarding-nav"
          onClick={goNext}
          disabled={!canNext}
          aria-label="Pasos siguientes"
        >
          <FiChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}

export default OnboardingChecklist;
