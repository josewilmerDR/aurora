import { Link } from 'react-router-dom';
import { usePageTitle } from '../../../hooks/usePageTitle';
import LandingFooter from '../../landing/components/LandingFooter';
import { LEGAL_VERSION, LEGAL_REVIEW_PENDING, LEGAL_ROUTES } from '../lib/legal';
import '../../landing/styles/landing.css';
import '../styles/legal.css';

// Human-readable Spanish date from the ISO version (YYYY-MM-DD). No
// `new Date()` so the output does not depend on the visitor's time zone.
function formatVersion(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${d} de ${months[m - 1]} de ${y}`;
}

/**
 * Shared frame for the public legal pages (/terms, /privacy). Reuses the
 * landing header/footer look without its in-page anchors, which would point
 * to sections that do not exist on these routes.
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
            <Link className="lp-header-nav-link" to={LEGAL_ROUTES.terms}>Términos</Link>
            <Link className="lp-header-nav-link" to={LEGAL_ROUTES.privacy}>Privacidad</Link>
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
