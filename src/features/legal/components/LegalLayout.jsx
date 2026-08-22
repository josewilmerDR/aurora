import { Link } from 'react-router-dom';
import { usePageTitle } from '../../../hooks/usePageTitle';
import LandingFooter from '../../landing/components/LandingFooter';
import { LEGAL_VERSION, LEGAL_REVIEW_PENDING, LEGAL_ROUTES } from '../lib/legal';
import '../../landing/styles/landing.css';
import '../styles/legal.css';

// Fecha legible en español a partir de la versión ISO (YYYY-MM-DD). Sin
// `new Date()` para no depender de la zona horaria del visitante.
function formatVersion(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${d} de ${meses[m - 1]} de ${y}`;
}

/**
 * Marco compartido de las páginas legales públicas (/terminos, /privacidad).
 * Reusa el header/footer visual de la landing pero sin sus anclas internas,
 * que en estas rutas apuntarían a secciones inexistentes.
 */
export default function LegalLayout({ title, children }) {
  usePageTitle(title);

  return (
    <div className="lp-root legal-root">
      <a className="aur-skip-link" href="#legal-main">Saltar al contenido</a>

      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <Link className="lp-brand" to="/" aria-label="aurora, inicio">
            <img className="lp-brand-mark" src="/aurora-logo.png" alt="" />
            <span className="lp-brand-name">aurora</span>
          </Link>
          <nav className="lp-header-nav" aria-label="Documentos legales">
            <Link className="lp-header-nav-link" to={LEGAL_ROUTES.terminos}>Términos</Link>
            <Link className="lp-header-nav-link" to={LEGAL_ROUTES.privacidad}>Privacidad</Link>
          </nav>
          <div className="lp-header-actions">
            <Link className="aur-btn-text lp-header-login" to="/login">Iniciar sesión</Link>
          </div>
        </div>
      </header>

      <main className="legal-main" id="legal-main">
        <article className="lp-container legal-article">
          <header className="legal-head">
            <h1 className="legal-title">{title}</h1>
            <p className="legal-meta">
              Versión {LEGAL_VERSION} · Última actualización: {formatVersion(LEGAL_VERSION)}
            </p>
            {LEGAL_REVIEW_PENDING && (
              <p className="legal-review-notice" role="note">
                Versión preliminar en revisión legal. Puede cambiar antes de su publicación definitiva.
              </p>
            )}
          </header>
          {children}
        </article>
      </main>

      <LandingFooter />
    </div>
  );
}
