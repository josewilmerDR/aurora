import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiChevronLeft, FiChevronRight, FiCheck, FiX } from 'react-icons/fi';
import { useOnboardingProgress } from '../../../hooks/useOnboardingProgress';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import { setCompletedSticky, isFirstViewDismissed, setFirstViewDismissed } from '../lib/onboardingState';

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
function StepColumn({ step, isActive, isGlobalFirst, isGlobalLast, prevDone, onNavigate }) {
  const state = step.completed ? 'done' : isActive ? 'active' : 'future';
  const leftOn  = !isGlobalFirst && prevDone;
  const rightOn = !isGlobalLast && step.completed;

  const inner = (
    <>
      <div className="dash-onboarding-col-text">
        <div className={`dash-onboarding-col-title is-${state}`}>{step.label}</div>
        {step.description && (
          <div className={`dash-onboarding-col-hint is-${state}`}>{step.description}</div>
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
        onClick={() => {
          window.dispatchEvent(new CustomEvent('aurora:open'));
          onNavigate?.();
        }}
      >
        {inner}
      </button>
    );
  }
  return (
    <Link to={step.to} className={`dash-onboarding-col is-${state}`} onClick={() => onNavigate?.()}>
      {inner}
    </Link>
  );
}

function OnboardingChecklist({ mode = 'fab' }) {
  const { firebaseUser, currentUser } = useUser();
  const uid = firebaseUser?.uid || null;
  const isAdmin = hasMinRole(currentUser?.rol, 'administrador');
  const enabled = Boolean(uid && isAdmin);

  const { steps, completedCount, total, percent, completedSticky, loading } =
    useOnboardingProgress({ enabled, uid });
  const viewSize = useResponsiveViewSize();

  // Render mode:
  //   - "inline": card embebida al final del Dashboard, mostrada hasta que el
  //     usuario la cierre por primera vez. Tras cerrarla, cede el render al FAB.
  //   - "fab" (default): badge global flotante con popover (comportamiento
  //     original); sólo aparece después de que el usuario cerró la card inline.
  const isInline = mode === 'inline';
  // `firstViewDismissedTick` re-lee el flag cuando dispatchamos
  // 'aurora:onboarding-refresh' (incluye `setFirstViewDismissed`).
  const [firstViewTick, setFirstViewTick] = useState(0);
  useEffect(() => {
    const bump = () => setFirstViewTick(t => t + 1);
    window.addEventListener('aurora:onboarding-refresh', bump);
    return () => window.removeEventListener('aurora:onboarding-refresh', bump);
  }, []);
  void firstViewTick;
  const firstViewDismissed = enabled ? isFirstViewDismissed(uid) : true;

  // El badge es FAB global (siempre visible mientras enabled). El popover se
  // abre/cierra con `open`. No persistimos el estado: cada sesión arranca con
  // el badge contraído, igual que el chat de Aurora.
  const [open, setOpen] = useState(false);
  const [windowOverride, setWindowOverride] = useState(null);

  // Una vez completados todos los pasos, sellar para siempre.
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
  // Una sola instancia se rinde a la vez según el flag de "primera vista":
  //   - mode=inline → sólo si el usuario aún no la ha cerrado.
  //   - mode=fab    → sólo después de cerrar la inline.
  if (isInline && firstViewDismissed) return null;
  if (!isInline && !firstViewDismissed) return null;

  const toggle = () => setOpen(o => {
    const next = !o;
    // Al abrir, fuerza un refetch del progreso por si el usuario completó
    // un paso en la página actual sin navegar (p.ej. crear un lote en /lotes).
    if (next) {
      try { window.dispatchEvent(new CustomEvent('aurora:onboarding-refresh')); }
      catch { /* ignore */ }
    }
    return next;
  });
  const close  = () => setOpen(false);

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

  // Cierre desde el modo inline → marca el flag de "primera vista cerrada" y
  // re-renderiza ambos modos: este componente desaparece y el FAB toma el relevo.
  const closeInline = () => setFirstViewDismissed(uid);

  // Card body: hint + carrusel. Compartido entre el render inline y el popover.
  const cardContent = (
    <>
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
                onNavigate={isInline ? undefined : close}
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
    </>
  );

  // ── Inline mode (Dashboard, primera vista) ──────────────────────────────
  if (isInline) {
    return (
      <section
        className="dash-onboarding-card dash-onboarding-inline"
        role="region"
        aria-label="Configuración inicial"
      >
        <button
          type="button"
          className="dash-onboarding-minimize"
          onClick={closeInline}
          title="Cerrar"
          aria-label="Cerrar onboarding"
        >
          <FiX size={16} />
        </button>
        {cardContent}
      </section>
    );
  }

  // ── FAB mode (global, tras cerrar la inline) ────────────────────────────
  return (
    <>
      <button
        type="button"
        className={`dash-onboarding-badge${open ? ' is-open' : ''}`}
        onClick={toggle}
        title={`Onboarding · ${completedCount}/${total} pasos completados`}
        aria-label={open ? 'Cerrar onboarding' : `Abrir onboarding, ${completedCount} de ${total} pasos completados`}
        aria-expanded={open}
      >
        <ProgressRing percent={percent} />
        <span className="dash-onboarding-badge-count">{completedCount}/{total}</span>
      </button>

      {open && (
        <section
          className="dash-onboarding-card dash-onboarding-popover"
          role="region"
          aria-label="Configuración inicial"
        >
          <button
            type="button"
            className="dash-onboarding-minimize"
            onClick={close}
            title="Cerrar"
            aria-label="Cerrar onboarding"
          >
            <FiX size={16} />
          </button>
          {cardContent}
        </section>
      )}
    </>
  );
}

export default OnboardingChecklist;
