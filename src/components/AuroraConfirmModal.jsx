import { FiAlertTriangle } from 'react-icons/fi';
import AuroraModal from './AuroraModal';

/**
 * AuroraConfirmModal — diálogo de confirmación construido sobre AuroraModal.
 *
 * API pública sin cambios respecto a la versión anterior (51 callsites). Lo
 * que sí cambió internamente: ahora hereda focus trap, focus restore, Escape
 * para cancelar, role="dialog" / aria-labelledby y el patrón robusto de
 * backdrop (mousedown/click ref que evita el cierre al arrastrar texto).
 *
 * Props:
 *   - title           string  · texto principal de la pregunta
 *   - body            ReactNode · texto/JSX de soporte (queda dentro de un <p>)
 *   - children        ReactNode · contenido extra entre body y actions
 *                                 (checkbox, tabla, lista, etc.)
 *   - confirmLabel    string  · texto del botón confirmar (default: "Confirmar")
 *   - cancelLabel     string  · texto del botón cancelar (default: "Cancelar")
 *   - showCancel      bool    · si false, oculta cancelar (default: true)
 *   - confirmDisabled bool    · deshabilita confirmar sin tocar cancelar
 *   - size            string  · 'default' (420px) | 'wide' (520px) | 'lg' (720px) | 'xl' (920px)
 *   - danger          bool    · estilo destructivo (icono + pill magenta)
 *   - iconVariant     string  · 'warn' (default) | 'neutral' — color del icono cuando NO es danger
 *   - icon            ReactNode · icono custom (default: FiAlertTriangle)
 *   - loading         bool    · deshabilita botones + bloquea cierre
 *   - loadingLabel    string  · texto del confirmar mientras loading
 *   - onConfirm       fn      · callback al confirmar
 *   - onCancel        fn      · callback al cancelar (también al click fuera / Escape)
 */
export default function AuroraConfirmModal({
  title,
  body,
  children,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  showCancel = true,
  confirmDisabled = false,
  size = 'default',
  danger = false,
  iconVariant = 'warn',
  icon,
  loading = false,
  loadingLabel = 'Procesando…',
  onConfirm,
  onCancel,
}) {
  const modalIconVariant = danger
    ? 'danger'
    : iconVariant === 'neutral'
      ? 'accent'
      : 'warn';
  const pillClass = `aur-btn-pill${danger ? ' aur-btn-pill--danger' : ''}`;

  const footer = (
    <>
      {showCancel && (
        <button
          type="button"
          className="aur-btn-text"
          onClick={onCancel}
          disabled={loading}
        >
          {cancelLabel}
        </button>
      )}
      <button
        type="button"
        className={pillClass}
        onClick={onConfirm}
        disabled={loading || confirmDisabled}
      >
        {loading ? loadingLabel : confirmLabel}
      </button>
    </>
  );

  return (
    <AuroraModal
      title={title}
      icon={icon ?? <FiAlertTriangle size={16} />}
      iconVariant={modalIconVariant}
      size={size}
      showCloseButton={false}
      preventClose={loading}
      onClose={onCancel}
      footer={footer}
    >
      {body && <p className="aur-modal-body">{body}</p>}
      {children}
    </AuroraModal>
  );
}
