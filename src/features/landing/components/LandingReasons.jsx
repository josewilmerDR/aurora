import { FiShield, FiSmartphone, FiClipboard, FiCpu } from 'react-icons/fi';
import { LANDING_REASONS } from '../lib/content';

const GLYPH_ICONS = {
  shield: FiShield,
  smartphone: FiSmartphone,
  clipboard: FiClipboard,
  cpu: FiCpu,
};

export default function LandingReasons() {
  return (
    <section className="lp-section" aria-labelledby="lp-reasons-title">
      <div className="lp-container">
        <header className="lp-section-head">
          <p className="lp-eyebrow">Por qué Aurora</p>
          <h2 className="lp-section-title" id="lp-reasons-title">
            Hecho para la realidad de una finca
          </h2>
        </header>

        <ul className="lp-reasons">
          {LANDING_REASONS.map(reason => {
            const Icon = GLYPH_ICONS[reason.glyph];
            return (
              <li className="lp-reason" key={reason.id}>
                <span className="lp-reason-icon" aria-hidden="true">
                  {Icon && <Icon size={18} />}
                </span>
                <div className="lp-reason-text">
                  <h3 className="lp-reason-title">{reason.title}</h3>
                  <p className="lp-reason-body">{reason.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
