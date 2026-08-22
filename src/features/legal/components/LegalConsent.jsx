import { Link } from 'react-router-dom';
import { LEGAL_ROUTES } from '../lib/legal';

/**
 * Checkbox de aceptación de Términos + Política de privacidad + encargo de
 * tratamiento. Se usa al crear una organización (FincaForm), que es el punto
 * donde nace la relación finca (responsable) ↔ Aurora (encargado).
 *
 * Controlado por el padre: `checked`/`onChange`. `error` pinta el mensaje de
 * validación con la misma semántica ARIA que el resto de campos de auth.
 */
export default function LegalConsent({ id = 'acepta-terminos', checked, onChange, disabled = false, error = '' }) {
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
          <Link to={LEGAL_ROUTES.terminos} target="_blank" rel="noopener">Términos del servicio</Link>
          {' '}y la{' '}
          <Link to={LEGAL_ROUTES.privacidad} target="_blank" rel="noopener">Política de privacidad</Link>,
          y confirmo que tengo autoridad para aceptarlos en nombre de esta organización,
          incluido el encargo a Aurora del tratamiento de los datos de su personal.
        </span>
      </label>
      {error && <span id={errorId} className="aur-field-error">{error}</span>}
    </div>
  );
}
