import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';
import { useUser } from '../../../contexts/UserContext';
import { useAuthRedirect, safeRedirectPath } from '../hooks/useAuthRedirect';
import { authErrorMessage } from '../lib/authErrors';
import AuthCard from '../components/AuthCard';
import PasswordInput from '../components/PasswordInput';
import '../styles/auth.css';

export default function LoginPassword() {
  const { login } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  const emailFromState = location.state?.email || '';
  const from = safeRedirectPath(location.state?.from);

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Llegada sin email (URL directa o refresh, que borra el state del history):
  // no hay nada a lo que pedir contraseña → volvemos a /login. El guard de
  // render (más abajo) evita pintar la card con email vacío por un frame.
  useEffect(() => {
    if (!emailFromState) navigate('/login', { replace: true });
  }, [emailFromState, navigate]);

  useAuthRedirect(from);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await login(emailFromState, password);
      // No reseteamos submitting en éxito: la navegación la hace useAuthRedirect
      // cuando el context resuelve (currentUser carga async vía /api/auth/me).
      // Mantener el botón en loading evita el flicker "Entrar" y el doble submit.
    } catch (err) {
      setError(authErrorMessage(err.code, 'No se pudo iniciar sesión. Intenta de nuevo.'));
      setSubmitting(false);
    }
  };

  const handlePasswordChange = (e) => {
    setPassword(e.target.value);
    if (error) setError(''); // limpiar el error al corregir, no esperar al submit
  };

  if (!emailFromState) return null;

  return (
    <AuthCard title="Ingresa tu contraseña">
      <p className="auth-subtitle auth-email-display">{emailFromState}</p>

      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        {/* Username oculto: en este flujo partido en dos pantallas, le da a los
            gestores de contraseña el email para asociar el par email→password. */}
        <input
          type="email"
          name="email"
          value={emailFromState}
          autoComplete="username"
          readOnly
          hidden
        />
        <div className="aur-field">
          <label htmlFor="password" className="aur-field-label">Contraseña</label>
          <PasswordInput
            id="password"
            value={password}
            onChange={handlePasswordChange}
            placeholder="••••••••"
            disabled={submitting}
            autoComplete="current-password"
            autoFocus
            required
            aria-invalid={!!error}
            aria-describedby={error ? 'password-error' : undefined}
          />
          <Link to="/forgot-password" state={{ email: emailFromState }} className="auth-forgot-link">¿Olvidaste tu contraseña?</Link>
        </div>

        {error && <p id="password-error" className="auth-error" role="alert">{error}</p>}

        <button type="submit" className="aur-btn-pill auth-btn-submit" disabled={submitting || !password}>
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      <button className="auth-back-btn" onClick={() => navigate('/login', { state: { from } })}>
        <FiArrowLeft size={14} /> Usar otro correo
      </button>
    </AuthCard>
  );
}
