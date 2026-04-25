import { createPortal } from 'react-dom';
import { FiAlertTriangle } from 'react-icons/fi';

/**
 * AuroraConfirmModal — confirmation dialog usando primitivas .aur-modal-*.
 *
 * Reemplaza:
 *   - El componente local `ConfirmModal` que vive en SiembraHistorial.jsx y
 *     SiembraMateriales.jsx (duplicado).
 *   - Cualquier `window.confirm()` nativo en el codebase.
 *
 * Props:
 *   - title          string  · texto principal de la pregunta
 *   - body           string  · texto de soporte (opcional)
 *   - confirmLabel   string  · texto del botón confirmar (default: "Confirmar")
 *   - cancelLabel    string  · texto del botón cancelar (default: "Cancelar")
 *   - danger         bool    · estilo destructivo (icono + pill magenta)
 *   - icon           ReactNode · icono custom (default: FiAlertTriangle)
 *   - onConfirm      fn      · callback al confirmar
 *   - onCancel       fn      · callback al cancelar (también al click fuera)
 *
 * Ejemplo:
 *   <AuroraConfirmModal
 *     danger
 *     title="¿Eliminar registro?"
 *     body="Esta acción no se puede deshacer."
 *     confirmLabel="Eliminar"
 *     onConfirm={() => doDelete(id)}
 *     onCancel={() => setConfirm(null)}
 *   />
 */
export default function AuroraConfirmModal({
  title,
  body,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  icon,
  onConfirm,
  onCancel,
}) {
  const iconClass = `aur-modal-icon${danger ? ' aur-modal-icon--danger' : ' aur-modal-icon--warn'}`;
  const pillClass = `aur-btn-pill${danger ? ' aur-btn-pill--danger' : ''}`;

  return createPortal(
    <div className="aur-modal-backdrop" onPointerDown={onCancel}>
      <div className="aur-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="aur-modal-header">
          <span className={iconClass}>
            {icon ?? <FiAlertTriangle size={16} />}
          </span>
          <span className="aur-modal-title">{title}</span>
        </div>
        {body && <p className="aur-modal-body">{body}</p>}
        <div className="aur-modal-actions">
          <button type="button" className="aur-btn-text" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={pillClass} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
