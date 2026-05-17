import { Component } from 'react';
import { FiAlertOctagon, FiHome, FiRefreshCw } from 'react-icons/fi';
import './ErrorBoundary.css';

/**
 * ErrorBoundary — captura excepciones de renderizado en el árbol de hijos
 * para evitar que la app se quede en pantalla en blanco.
 *
 * React solo expone esta capacidad vía class components con
 * `getDerivedStateFromError` + `componentDidCatch`. La idea es:
 *
 *   1. Si un descendant tira durante render, marcamos `hasError`.
 *   2. Mostramos un fallback amigable con CTA a "Volver al inicio" y
 *      "Recargar". No le pedimos al usuario que reporte el error — solo
 *      que recupere control sin verse en una pantalla blanca.
 *   3. Logueamos a console para que QA/dev lo vean al menos en local;
 *      cuando integremos error tracking (Sentry/etc.), el hook va aquí.
 *
 * Wrappear `<Routes>` con esto significa que un error en una página NO
 * tumba el header + sidebar — el usuario navega a otra página vía CTA y
 * el boundary se resetea solo (cambio de location resetea el árbol).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[Aurora] Error de renderizado:', error, info?.componentStack);
  }

  handleHome = () => {
    // Limpia el estado y deja que el router maneje la navegación.
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="aur-error-boundary">
        <div className="aur-error-boundary-card">
          <div className="aur-error-boundary-icon" aria-hidden="true">
            <FiAlertOctagon size={36} />
          </div>
          <h1 className="aur-error-boundary-title">Algo salió mal</h1>
          <p className="aur-error-boundary-subtitle">
            La página dejó de responder por un error inesperado. Tu trabajo
            guardado no se perdió.
          </p>
          <div className="aur-error-boundary-actions">
            <button type="button" className="aur-btn-pill" onClick={this.handleHome}>
              <FiHome size={14} /> Volver al inicio
            </button>
            <button type="button" className="aur-btn-text" onClick={this.handleReload}>
              <FiRefreshCw size={14} /> Recargar la página
            </button>
          </div>
        </div>
      </div>
    );
  }
}
