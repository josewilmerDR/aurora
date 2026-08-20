import { Link } from 'react-router-dom';
import EcosystemMenu from '../../../components/EcosystemMenu';

// Anclas de la propia página. En móvil se ocultan (el recorrido ahí es
// scrollear, no saltar) y quedan solo las dos acciones de cuenta.
const NAV_LINKS = [
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#modulos', label: 'Módulos' },
];

export default function LandingHeader() {
  return (
    <header className="lp-header">
      <div className="lp-container lp-header-inner">
        <Link className="lp-brand" to="/" aria-label="aurora, inicio">
          <img className="lp-brand-mark" src="/aurora-logo.png" alt="" />
          <span className="lp-brand-name">aurora</span>
        </Link>

        <nav className="lp-header-nav" aria-label="Secciones de la página">
          {NAV_LINKS.map(link => (
            <a key={link.href} className="lp-header-nav-link" href={link.href}>{link.label}</a>
          ))}
        </nav>

        <div className="lp-header-actions">
          {/* Mismo lanzador que dentro de la app: desde la landing ya se puede
              saltar a los otros productos de comunplace. */}
          <EcosystemMenu />
          <Link className="aur-btn-text lp-header-login" to="/login">Iniciar sesión</Link>
          <Link className="aur-btn-pill lp-cta lp-cta--sm" to="/register">Crear cuenta</Link>
        </div>
      </div>
    </header>
  );
}
