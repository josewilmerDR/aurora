import { useId } from 'react';
import AuroraModal from './AuroraModal';

// Wrapper de AuroraModal para el caso "formulario con cancelar/guardar".
// Envuelve children en <form onSubmit> (Enter dentro del modal envía) y
// renderiza un footer estandarizado con dos botones (cancelar + submit).
// Mantiene el patrón "padre monta/desmonta" del resto de modales.

export default function AuroraFormModal({
  onClose,
  onSubmit,                    // (e) => void  — recibe el event del form
  title,
  icon,
  iconVariant,
  size,
  scrollable = true,           // forms suelen tener varios campos → scroll
  closeOnBackdrop,
  closeOnEscape,
  showCloseButton,
  initialFocusRef,
  className,
  contentClassName,
  ariaLabel,
  submitLabel = 'Guardar',
  cancelLabel = 'Cancelar',
  submitDisabled = false,
  submitVariant = 'primary',   // 'primary' | 'danger'
  loading = false,
  loadingLabel = 'Guardando…',
  children,
}) {
  const formId = useId();
  const pillClass = `aur-btn-pill${submitVariant === 'danger' ? ' aur-btn-pill--danger' : ''}`;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (loading || submitDisabled) return;
    onSubmit?.(e);
  };

  const footer = (
    <>
      <button
        type="button"
        className="aur-btn-text"
        onClick={onClose}
        disabled={loading}
      >
        {cancelLabel}
      </button>
      <button
        type="submit"
        form={formId}
        className={pillClass}
        disabled={loading || submitDisabled}
      >
        {loading ? loadingLabel : submitLabel}
      </button>
    </>
  );

  return (
    <AuroraModal
      onClose={onClose}
      title={title}
      icon={icon}
      iconVariant={iconVariant}
      size={size}
      scrollable={false}                      /* el <form> envuelve el content */
      closeOnBackdrop={closeOnBackdrop}
      closeOnEscape={closeOnEscape}
      showCloseButton={showCloseButton}
      initialFocusRef={initialFocusRef}
      className={className}
      ariaLabel={ariaLabel}
      preventClose={loading}
      footer={footer}
    >
      <form
        id={formId}
        onSubmit={handleSubmit}
        className={scrollable ? `aur-modal-content${contentClassName ? ' ' + contentClassName : ''}` : contentClassName}
      >
        {children}
      </form>
    </AuroraModal>
  );
}
