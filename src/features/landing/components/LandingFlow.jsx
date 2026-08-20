import { LANDING_STEPS } from '../lib/content';

export default function LandingFlow() {
  return (
    <section className="lp-section" id="como-funciona" aria-labelledby="lp-flow-title">
      <div className="lp-container">
        <header className="lp-section-head">
          <p className="lp-eyebrow">Cómo funciona</p>
          <h2 className="lp-section-title" id="lp-flow-title">
            El trabajo se programa solo; tú revisas lo que importa
          </h2>
          <p className="lp-section-body">
            Aurora reparte el trabajo del día y va armando el costo mientras el equipo lo
            ejecuta, para que decidas con información de hoy y no con el cierre del mes.
          </p>
        </header>

        <ol className="lp-steps">
          {LANDING_STEPS.map((step, i) => (
            <li className="lp-step" key={step.id}>
              <span className="lp-step-num">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="lp-step-title">{step.title}</h3>
              <p className="lp-step-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
