import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { FiEye, FiEyeOff, FiArrowLeft } from 'react-icons/fi';
import { useUser } from '../contexts/UserContext';
import './Login.css';

export default function LoginPassword() {
  const { login, isLoggedIn, needsSetup, needsOrgSelection } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  // Si llegan sin email (acceso directo a la URL), volver al login
  const emailFromState = location.state?.email || '';
  useEffect(() => {
    if (!emailFromState) navigate('/login', { replace: true });
  }, [emailFromState, navigate]);

  useEffect(() => {
    if (isLoggedIn) navigate('/', { replace: true });
    else if (needsOrgSelection) navigate('/', { replace: true });
    else if (needsSetup) navigate('/register', { replace: true });
  }, [isLoggedIn, needsOrgSelection, needsSetup, navigate]);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/aurora-logo.png" alt="Aurora" className="login-logo-img" />
          <span className="login-logo-label">Aurora</span>
        </div>

        <h2 className="login-title">Bienvenido</h2>
        <p className="login-subtitle login-email-display">{emailFromState}</p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label htmlFor="password">Contraseña</label>
            <div className="login-input-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={submitting}
                autoComplete="current-password"
                autoFocus
                required
              />
              <button type="button" className="login-eye-btn" onClick={() => setShowPassword(v => !v)} tabIndex={-1}>
                {showPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
              </button>
            </div>
            <Link to="/forgot-password" className="login-forgot-link">¿Olvidaste tu contraseña?</Link>
          </div>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="login-btn" disabled={submitting || !password}>
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <button className="login-back-btn" onClick={() => navigate('/login')}>
          <FiArrowLeft size={14} /> Usar otro correo
        </button>
      </div>
    </div>
  );
}
