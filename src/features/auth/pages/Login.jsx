import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { FiArrowRight } from 'react-icons/fi';
import { useUser } from '../../../contexts/UserContext';
import { useAuthRedirect, safeRedirectPath } from '../hooks/useAuthRedirect';
import { authErrorMessage } from '../lib/authErrors';
import { useBlurValidation } from '../../../hooks/useBlurValidation';
import { isValidEmail } from '../../../lib/validators';
import AuthCard from '../components/AuthCard';
import GoogleButton from '../components/GoogleButton';
import AuthLoading from '../components/AuthLoading';
import '../styles/auth.css';

// Tras autenticar con Google mantenemos el spinner esperando a que UserContext
// resuelva (currentUser + memberships). Si el perfil nunca carga (ej. GET
// /api/auth/me falla en un cold start), sin este tope el usuario queda en el
// spinner para siempre; a los 15s mostramos un error accionable.
const PROFILE_TIMEOUT_MS = 15000;

function validate(form) {
  const errs = {};
  const email = (form.email || '').trim();
  if (!email) errs.email = 'Ingresa tu correo electrónico.';
  else if (!isValidEmail(email)) errs.email = 'Email inválido.';
  return errs;
}

export default function Login() {
  const { loginWithGoogle } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const from = safeRedirectPath(location.state?.from);

  const [email, setEmail] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const { fieldErrors, blurField, clearField, validateAll, inputClass } = useBlurValidation(validate);

  useAuthRedirect(from);

  useEffect(() => {
    if (!googleLoading) return undefined;
    const t = setTimeout(() => {
      setGoogleLoading(false);
      setError('No pudimos cargar tu perfil. Intenta de nuevo.');
    }, PROFILE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [googleLoading]);

  const handleEmailSubmit = (e) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!validateAll({ email: cleanEmail })) return;
    navigate('/login/contrasena', { state: { email: cleanEmail, from } });
  };

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    clearField('email');
    if (error) setError(''); // limpiar el error de página al corregir, no esperar al submit
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    try {
      await loginWithGoogle();
      // Keep loading state — useAuthRedirect navigates when the context resolves
    } catch (err) {
      setGoogleLoading(false);
      // El usuario cerró/canceló el popup: no es un error que mostrar.
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
      setError(authErrorMessage(err.code, 'No se pudo iniciar sesión con Google.'));
    }
  };

  if (googleLoading) {
    return (
      <AuthCard>
        <AuthLoading />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Bienvenido"
      subtitle="Ingresa a tu cuenta para continuar"
      footer={
        <p className="auth-register-link">
          ¿No tienes cuenta? <Link to="/register">Crear cuenta</Link>
        </p>
      }
    >
      <GoogleButton onClick={handleGoogle} loading={googleLoading} />

      {/* Error de Google: justo debajo del botón que lo origina, no enterrado
          bajo el campo de email (acción no relacionada). */}
      {error && <p className="auth-error" role="alert">{error}</p>}

      <div className="auth-divider"><span>o</span></div>

      <form onSubmit={handleEmailSubmit} className="auth-form" noValidate>
        <div className="aur-field">
          <label htmlFor="email" className="aur-field-label">Correo electrónico</label>
          <div className="auth-input-wrap">
            <input
              id="email"
              name="email"
              type="email"
              className={inputClass('email')}
              value={email}
              onChange={handleEmailChange}
              onBlur={() => blurField('email', { email })}
              placeholder="tu@correo.com"
              autoComplete="email"
              autoFocus
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              required
            />
            <button
              type="submit"
              className="auth-input-arrow"
              disabled={!email}
              tabIndex={-1}
              aria-label="Continuar"
            >
              <FiArrowRight size={18} strokeWidth={2.5} />
            </button>
          </div>
          {fieldErrors.email && <span id="email-error" className="aur-field-error">{fieldErrors.email}</span>}
        </div>
      </form>
    </AuthCard>
  );
}
