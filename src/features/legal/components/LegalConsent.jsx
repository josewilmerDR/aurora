import { Link } from 'react-router-dom';
import { LEGAL_ROUTES } from '../lib/legal';

/**
 * Acceptance checkbox for Terms + Privacy Policy + data-processing mandate.
 * Used when creating an organization (FincaForm), the point where the
 * finca (controller) ↔ Aurora (processor) relationship is born.
 *
 * Controlled by the parent: `checked`/`onChange`. `error` renders the
 * validation message with the same ARIA semantics as the other auth fields.
 */
export default function LegalConsent({ id = 'accepts-terms', checked, onChange, disabled = false, error = '' }) {
  const errorId = `${id}-error`;
  return (
    <div className="aur-field auth-consent">
      <label className="auth-consent-label" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className="auth-consent-input"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          required
        />
        <span className="auth-consent-text">
          Acepto los{' '}
          <Link to={LEGAL_ROUTES.terms} target="_blank" rel="noopener">Términos del servicio</Link>
          {' '}y la{' '}
          <Link to={LEGAL_ROUTES.privacy} target="_blank" rel="noopener">Política de privacidad</Link>,
          y confirmo que tengo autoridad para aceptarlos en nombre de esta organización,
          incluido el encargo a Aurora del tratamiento de los datos de su personal.
        </span>
      </label>
      {error && <span id={errorId} className="aur-field-error">{error}</span>}
    </div>
  );
}
