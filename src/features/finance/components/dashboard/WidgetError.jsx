import { FiRefreshCw } from 'react-icons/fi';

/**
 * WidgetError — estado de error de un widget del dashboard.
 *
 * `role="alert"` para que el lector de pantalla anuncie el fallo al aparecer
 * (antes era un <div> mudo). Incluye botón "Reintentar" cuando el caller pasa
 * `onRetry`, evitando que un hipo de red obligue a recargar toda la página.
 */
export default function WidgetError({ message, onRetry }) {
  return (
    <div className="fin-widget-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="aur-btn-text fin-widget-retry" onClick={onRetry}>
          <FiRefreshCw size={12} aria-hidden="true" /> Reintentar
        </button>
      )}
    </div>
  );
}
