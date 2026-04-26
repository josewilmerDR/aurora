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
 *   - Los modales de Parameters.jsx (UnlockModal con checkbox, SaveModal
 *     con tabla de diff) — gracias al slot `children` y al prop
 *     `confirmDisabled`.
 *   - Cualquier `window.confirm()` nativo en el codebase.
 *
 * Props:
 *   - title           string  · texto principal de la pregunta
 *   - body            ReactNode · texto/JSX de soporte (opcional, queda
 *                                 dentro de un <p>; usa `children` para
 *                                 contenido con bloques)
 *   - children        ReactNode · contenido extra entre body y actions
 *                                 (checkbox, tabla, lista, etc.)
 *   - confirmLabel    string  · texto del botón confirmar (default: "Confirmar")
 *   - cancelLabel     string  · texto del botón cancelar (default: "Cancelar")
 *   - showCancel      bool    · si false, oculta el botón cancelar — útil
 *                               para diálogos informativos de un solo
 *                               botón ("Entendido") (default: true)
 *   - confirmDisabled bool    · deshabilita el botón confirmar sin tocar
 *                               el de cancelar — para gates (e.g. checkbox
 *                               "entiendo las implicaciones") (default: false)
 *   - size            string  · ancho del modal: 'default' (420px),
 *                               'wide' (520px), 'lg' (720px), 'xl' (920px).
 *                               Útil para diálogos con tablas u otros bloques
 *                               anchos en el slot children. (default: 'default')
 *   - danger          bool    · estilo destructivo (icono + pill magenta)
 *   - icon            ReactNode · icono custom (default: FiAlertTriangle)
 *   - loading         bool    · deshabilita ambos botones y backdrop, y
 *                               reemplaza el label de confirmar por loadingLabel
 *   - loadingLabel    string  · texto del confirmar mientras loading
 *                               (default: "Procesando…")
 *   - onConfirm       fn      · callback al confirmar
 *   - onCancel        fn      · callback al cancelar (también al click fuera)
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
 *
 * Ejemplo con children + gate:
 *   <AuroraConfirmModal
 *     title="Editar parámetros del sistema"
 *     body={<>Los cambios afectan los <strong>cálculos globales</strong>.</>}
 *     confirmLabel="Continuar"
 *     confirmDisabled={!checked}
 *     onConfirm={onConfirm}
 *     onCancel={onCancel}
 *   >
 *     <label>
 *       <input type="checkbox" checked={checked} onChange={...} />
 *       Entiendo las implicaciones
 *     </label>
 *   </AuroraConfirmModal>
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
  icon,
  loading = false,
  loadingLabel = 'Procesando…',
  onConfirm,
  onCancel,
}) {
  const iconClass = `aur-modal-icon${danger ? ' aur-modal-icon--danger' : ' aur-modal-icon--warn'}`;
  const pillClass = `aur-btn-pill${danger ? ' aur-btn-pill--danger' : ''}`;
  const sizeMod   = size === 'default' ? '' : ` aur-modal--${size}`;

  const handleBackdrop = () => {
    if (loading) return;
    onCancel?.();
  };

  return createPortal(
    <div className="aur-modal-backdrop" onPointerDown={handleBackdrop}>
      <div className={`aur-modal${sizeMod}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="aur-modal-header">
          <span className={iconClass}>
            {icon ?? <FiAlertTriangle size={16} />}
          </span>
          <span className="aur-modal-title">{title}</span>
        </div>
        {body && <p className="aur-modal-body">{body}</p>}
        {children}
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
            disabled={loading || confirmDisabled}
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
