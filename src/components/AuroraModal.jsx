import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiX } from 'react-icons/fi';

// Modal base. Reemplaza el patrón "abrir mi propio <div aur-modal-backdrop>"
// repetido en 25 archivos. Encapsula:
//   - createPortal a document.body
//   - role="dialog" / aria-modal / aria-labelledby
//   - cierre por Escape (sin pisar otros handlers que hicieron preventDefault)
//   - cierre por click en backdrop, robusto: ignora el click si el mousedown
//     empezó dentro del modal (drag de selección no debe cerrar)
//   - focus trap (Tab/Shift+Tab quedan dentro)
//   - focus initial al primer focusable o initialFocusRef
//   - focus restore al elemento previamente activo al desmontar
//   - body-scroll lock mientras el modal vive
//
// Patrón de uso (sin "open" prop — el padre monta/desmonta condicionalmente,
// igual que los 25 modales actuales):
//
//   {showFoo && (
//     <AuroraModal title="..." onClose={() => setShowFoo(false)}>
//       ...
//     </AuroraModal>
//   )}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusables(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter(el => {
      if (el.hasAttribute('hidden')) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      // checkVisibility() (Chrome 105+) descarta elementos con display:none
      // o visibility:hidden vía CSS. En jsdom y navegadores viejos no
      // existe — ahí confiamos en que el modal no contenga nodos ocultos.
      if (typeof el.checkVisibility === 'function') return el.checkVisibility();
      return true;
    });
}

export default function AuroraModal({
  onClose,
  title,
  icon,
  iconVariant = 'accent',     // 'accent' | 'warn' | 'danger' | 'none'
  size = 'default',           // 'default' | 'wide' | 'lg' | 'xl'
  scrollable = false,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  initialFocusRef,
  className = '',
  contentClassName = '',
  footer,
  ariaLabel,
  preventClose = false,
  children,
}) {
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);
  const downOnBackdropRef = useRef(false);
  const titleId = useId();

  // Focus inicial + restore al desmontar.
  useEffect(() => {
    restoreRef.current = document.activeElement;
    const raf = requestAnimationFrame(() => {
      const target = initialFocusRef?.current
        || dialogRef.current?.querySelector('[autofocus]')
        || getFocusables(dialogRef.current)[0]
        || dialogRef.current;
      target?.focus?.();
    });
    return () => {
      cancelAnimationFrame(raf);
      // Restaurar solo si el elemento sigue en el DOM y es focuseable.
      const prev = restoreRef.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [initialFocusRef]);

  // Escape (sin pisar handlers que ya manejaron la tecla) + focus trap en Tab.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && closeOnEscape && !preventClose) {
        onClose?.();
        return;
      }
      if (e.key === 'Tab') {
        const focusables = getFocusables(dialogRef.current);
        if (focusables.length === 0) {
          e.preventDefault();
          dialogRef.current?.focus?.();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        const inside = dialogRef.current?.contains(active);
        if (!inside) {
          first.focus();
          e.preventDefault();
        } else if (e.shiftKey && active === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && active === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeOnEscape, onClose, preventClose]);

  // Lock body scroll mientras el modal vive (sobrevive a nested modals porque
  // overflow:hidden ya está aplicado, solo restauramos el valor previo).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Backdrop close — usa el par mousedown/click para evitar el bug clásico:
  // si el usuario arrastró texto dentro del modal y soltó fuera, el click
  // bubble llega al backdrop. Solo cerramos si el mousedown empezó AHÍ.
  const handleBackdropMouseDown = (e) => {
    downOnBackdropRef.current = e.target === e.currentTarget;
  };
  const handleBackdropClick = (e) => {
    if (!closeOnBackdrop || preventClose) return;
    if (!downOnBackdropRef.current) return;
    downOnBackdropRef.current = false;
    if (e.target !== e.currentTarget) return;
    onClose?.();
  };

  const sizeMod = size === 'default' ? '' : ` aur-modal--${size}`;
  const modalClass = `aur-modal${sizeMod}${className ? ' ' + className : ''}`;

  const iconClass = (iconVariant === 'none' || !icon)
    ? null
    : `aur-modal-icon${
        iconVariant === 'warn' ? ' aur-modal-icon--warn'
        : iconVariant === 'danger' ? ' aur-modal-icon--danger'
        : ''
      }`;

  const hasHeader = !!(title || icon || showCloseButton);

  return createPortal(
    <div
      className="aur-modal-backdrop"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className={modalClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
      >
        {hasHeader && (
          <div className="aur-modal-header">
            {icon && iconClass && <span className={iconClass}>{icon}</span>}
            {title && (
              <h2 id={titleId} className="aur-modal-title">{title}</h2>
            )}
            {showCloseButton && (
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--sm aur-modal-close"
                onClick={() => { if (!preventClose) onClose?.(); }}
                disabled={preventClose}
                aria-label="Cerrar"
                title="Cerrar"
              >
                <FiX size={16} />
              </button>
            )}
          </div>
        )}
        {scrollable ? (
          <div className={`aur-modal-content${contentClassName ? ' ' + contentClassName : ''}`}>
            {children}
          </div>
        ) : (
          children
        )}
        {footer && <div className="aur-modal-actions">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
