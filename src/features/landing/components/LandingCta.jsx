import { Link } from 'react-router-dom';
import { FiArrowRight } from 'react-icons/fi';

export default function LandingCta() {
  return (
    <section className="lp-cta-section" aria-labelledby="lp-cta-title">
      <div className="lp-container lp-cta-inner">
        <h2 className="lp-cta-title" id="lp-cta-title">Empezá por tu primera finca</h2>
        <p className="lp-cta-body">
          Creas la organización, cargas tus lotes y sumas a tu equipo con el rol de cada quien.
          Desde ahí Aurora empieza a programar el trabajo y a acumular el costo.
        </p>
        <div className="lp-cta-actions">
          <Link className="aur-btn-pill lp-cta" to="/register">
            Crear cuenta <FiArrowRight size={16} strokeWidth={2.5} />
          </Link>
          <Link className="aur-btn-text lp-cta-secondary" to="/login">Iniciar sesión</Link>
        </div>
      </div>
    </section>
  );
}
