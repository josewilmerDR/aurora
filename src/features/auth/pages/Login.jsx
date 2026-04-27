import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { FiArrowRight } from 'react-icons/fi';
import { useUser } from '../../../contexts/UserContext';
import AuthCard from '../components/AuthCard';
import GoogleButton from '../components/GoogleButton';
import AuthLoading from '../components/AuthLoading';
import '../styles/auth.css';

export default function Login() {
  const { loginWithGoogle, isLoggedIn, needsSetup, needsOrgSelection } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';

  useEffect(() => {
    if (isLoggedIn) navigate(from, { replace: true });
    else if (needsOrgSelection) navigate(from, { replace: true });
    else if (needsSetup) navigate('/register', { replace: true });
  }, [isLoggedIn, needsOrgSelection, needsSetup, navigate, from]);

  const [email, setEmail] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const handleEmailSubmit = (e) => {
    e.preventDefault();
    if (!email) return;
    navigate('/login/contrasena', { state: { email, from } });
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    try {
      await loginWithGoogle();
      // Keep loading state — useEffect will navigate when context resolves
    } catch (err) {
      setGoogleLoading(false);
      if (err.code === 'auth/account-exists-with-different-credential' || err.code === 'auth/email-already-in-use') {
        setError('Este correo ya tiene contraseña. Ingresa con correo y contraseña, luego vincula Google desde Mi perfil.');
      } else if (err.code !== 'auth/popup-closed-by-user') {
        setError('No se pudo iniciar sesión con Google.');
      }
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
      <GoogleButton onClick={handleGoogle} />

      <div className="auth-divider"><span>o</span></div>

      <form onSubmit={handleEmailSubmit} className="auth-form">
        <div className="aur-field">
          <label htmlFor="email" className="aur-field-label">Correo electrónico</label>
          <div className="auth-input-wrap">
            <input
              id="email"
              type="email"
              className="aur-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              autoComplete="email"
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
        </div>
        {error && <p className="auth-error">{error}</p>}
      </form>
    </AuthCard>
  );
}
