import { Link } from 'react-router-dom';
import { FiArrowRight } from 'react-icons/fi';
import LandingPreview from './LandingPreview';

export default function LandingHero() {
  return (
    <section className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-container lp-hero-inner">
        <div className="lp-hero-text">
          <p className="lp-eyebrow">Software de gestión agrícola · comunplace</p>

          <h1 className="lp-hero-title" id="lp-hero-title">
            Tu finca ordenada,<br />
            <span className="lp-hero-title-accent">de la siembra al costo.</span>
          </h1>

          <p className="lp-hero-body">
            Aurora programa las labores de cada lote, controla la bodega, liquida la planilla
            y te dice cuánto costó producir. Fácil y 100% adaptado a computadoras y teléfonos
          </p>

          <div className="lp-hero-actions">
            <Link className="aur-btn-pill lp-cta" to="/register">
              Crear cuenta <FiArrowRight size={16} strokeWidth={2.5} />
            </Link>
            <Link className="aur-btn-text lp-cta-secondary" to="/login">
              Ya tengo cuenta
            </Link>
          </div>

          {/* Nota de precio pegada al CTA: el alcance del plan gratuito se
              aclara antes de que el visitante entre a crear la cuenta. */}
          <p className="lp-hero-note">
            Aurora es gratis solo para uso personal
          </p>
        </div>

        <div className="lp-hero-art">
          <LandingPreview />
        </div>
      </div>
    </section>
  );
}
