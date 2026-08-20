import { usePageTitle } from '../../../hooks/usePageTitle';
import LandingHeader from '../components/LandingHeader';
import LandingHero from '../components/LandingHero';
import LandingFlow from '../components/LandingFlow';
import LandingModules from '../components/LandingModules';
import LandingReasons from '../components/LandingReasons';
import LandingCta from '../components/LandingCta';
import LandingFooter from '../components/LandingFooter';
import '../styles/landing.css';

/**
 * Landing pública de Aurora.
 *
 * Se sirve en "/" a los visitantes anónimos (ver ProtectedRoute en App.jsx) y
 * en "/bienvenido" siempre, para tener una URL estable a la que enlazar desde
 * comunplace aunque el visitante ya tenga sesión.
 *
 * A diferencia de luna o comunmarket, Aurora no puede ofrecer una prueba sin
 * cuenta: es el ERP de una finca concreta y no hay contenido público que
 * mostrar. Por eso la página explica el producto y el único destino es
 * crear cuenta / iniciar sesión, sin prometer un demo que no existe.
 */
export default function Landing() {
  usePageTitle('Software de gestión para fincas');

  return (
    <div className="lp-root">
      <a className="aur-skip-link" href="#lp-main">Saltar al contenido</a>

      <LandingHeader />

      <main className="lp-main" id="lp-main">
        <LandingHero />
        <LandingFlow />
        <LandingModules />
        <LandingReasons />
        <LandingCta />
      </main>

      <LandingFooter />
    </div>
  );
}
