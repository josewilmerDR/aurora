import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';
import { useUser } from '../../../contexts/UserContext';
import AuthCard from '../components/AuthCard';
import PasswordInput from '../components/PasswordInput';
import '../styles/auth.css';

export default function LoginPassword() {
  const { login, isLoggedIn, needsSetup, needsOrgSelection } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  // If they arrive without email (direct URL access), redirect to login
  const emailFromState = location.state?.email || '';
  useEffect(() => {
    if (!emailFromState) navigate('/login', { replace: true });
  }, [emailFromState, navigate]);

  const from = location.state?.from || '/';

  useEffect(() => {
    if (isLoggedIn) navigate(from, { replace: true });
    else if (needsOrgSelection) navigate(from, { replace: true });
    else if (needsSetup) navigate('/register', { replace: true });
  }, [isLoggedIn, needsOrgSelection, needsSetup, navigate, from]);

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError('');
    try {
      await login(emailFromState, password);
    } catch (err) {
      const code = err.code;
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Email o contraseña incorrectos.');
      } else if (code === 'auth/too-many-requests') {
        setError('Demasiados intentos. Intenta más tarde.');
      } else {
        setError('No se pudo iniciar sesión. Intenta de nuevo.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard title="Bienvenido">
      <p className="auth-subtitle auth-email-display">{emailFromState}</p>

      <form onSubmit={handleSubmit} className="auth-form">
        <div className="aur-field">
          <label htmlFor="password" className="aur-field-label">Contraseña</label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={submitting}
            autoComplete="current-password"
            autoFocus
            required
          />
          <Link to="/forgot-password" className="auth-forgot-link">¿Olvidaste tu contraseña?</Link>
        </div>

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" className="aur-btn-pill auth-btn-submit" disabled={submitting || !password}>
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      <button className="auth-back-btn" onClick={() => navigate('/login')}>
        <FiArrowLeft size={14} /> Usar otro correo
      </button>
    </AuthCard>
  );
}
