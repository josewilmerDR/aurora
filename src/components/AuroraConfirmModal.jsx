import { createPortal } from 'react-dom';
import { FiAlertTriangle } from 'react-icons/fi';

/**
 * AuroraConfirmModal — confirmation dialog usando primitivas .aur-modal-*.
 *
 * Reemplaza:
 *   - El componente compartido viejo `src/components/ConfirmModal.jsx`
 *     (ya borrado, junto con su CSS).
 *   - Las copias locales que vivían en SiembraHistorial.jsx,
 *     SiembraMateriales.jsx, Siembra.jsx (.am-* / .param-modal-*) y
 *     CedulasAplicacion.jsx (la versión .aur-modal-* con auto-close).
 *   - Cualquier `window.confirm()` nativo en el codebase.
 *
 * Props:
 *   - title          string  · texto principal de la pregunta
 *   - body           string  · texto de soporte (opcional)
 *   - confirmLabel   string  · texto del botón confirmar (default: "Confirmar")
 *   - cancelLabel    string  · texto del botón cancelar (default: "Cancelar")
 *   - showCancel     bool    · si false, oculta el botón cancelar — útil para
 *                              diálogos informativos de un solo botón ("Entendido")
 *                              (default: true)
 *   - danger         bool    · estilo destructivo (icono + pill magenta)
 *   - icon           ReactNode · icono custom (default: FiAlertTriangle)
 *   - loading        bool    · deshabilita ambos botones y backdrop, y
 *                              reemplaza el label de confirmar por loadingLabel
 *   - loadingLabel   string  · texto del confirmar mientras loading (default: "Procesando…")
 *   - onConfirm      fn      · callback al confirmar
 *   - onCancel       fn      · callback al cancelar (también al click fuera)
 *
 * Ejemplo:
 *   <AuroraConfirmModal
 *     danger
 *     title="¿Eliminar registro?"
 *     body="Esta acción no se puede deshacer."
 *     confirmLabel="Eliminar"
 *     loading={deleting}
 *     onConfirm={() => doDelete(id)}
 *     onCancel={() => setConfirm(null)}
 *   />
 */
export default function AuroraConfirmModal({
  title,
  body,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  showCancel = true,
  danger = false,
  icon,
  loading = false,
  loadingLabel = 'Procesando…',
  onConfirm,
  onCancel,
}) {
  const iconClass = `aur-modal-icon${danger ? ' aur-modal-icon--danger' : ' aur-modal-icon--warn'}`;
  const pillClass = `aur-btn-pill${danger ? ' aur-btn-pill--danger' : ''}`;

  const handleBackdrop = () => {
    if (loading) return;
    onCancel?.();
  };

  return createPortal(
    <div className="aur-modal-backdrop" onPointerDown={handleBackdrop}>
      <div className="aur-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="aur-modal-header">
          <span className={iconClass}>
            {icon ?? <FiAlertTriangle size={16} />}
          </span>
          <span className="aur-modal-title">{title}</span>
        </div>
        {body && <p className="aur-modal-body">{body}</p>}
        <div className="aur-modal-actions">
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
            disabled={loading}
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
