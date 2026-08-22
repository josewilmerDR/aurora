import { Link } from 'react-router-dom';
import { DIRECTORY_URL } from '../../../lib/ecosystem';

export default function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-inner">
        <div className="lp-brand lp-footer-brand">
          <img className="lp-brand-mark" src="/aurora-logo.png" alt="" />
          <span className="lp-brand-name">aurora</span>
        </div>

        <nav className="lp-footer-links" aria-label="Enlaces del pie de página">
          <Link to="/login">Iniciar sesión</Link>
          <Link to="/register">Crear cuenta</Link>
          <a href={DIRECTORY_URL}>comunplace</a>
          <Link to="/terms">Términos</Link>
          <Link to="/privacy">Privacidad</Link>
        </nav>

        <p className="lp-footer-legal">aurora · un producto de comunplace</p>
      </div>
    </footer>
  );
}
