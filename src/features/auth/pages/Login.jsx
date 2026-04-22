import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { FiArrowRight } from 'react-icons/fi';
import { useUser } from '../../../contexts/UserContext';
import '../styles/login.css';

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

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/aurora-logo.png" alt="Aurora" className="login-logo-img" />
          <span className="login-logo-label">Aurora</span>
        </div>

        {googleLoading ? (
          <div className="login-google-loading">
            <div className="login-google-spinner" />
            <p className="login-google-loading-text">Verificando cuenta...</p>
          </div>
        ) : (
          <>
            <h2 className="login-title">Bienvenido</h2>
            <p className="login-subtitle">Ingresa a tu cuenta para continuar</p>

            <button className="login-btn-google" onClick={handleGoogle}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continuar con Google
            </button>

            <div className="login-divider"><span>o</span></div>

            <form onSubmit={handleEmailSubmit} className="login-form">
              <div className="login-field">
                <label htmlFor="email">Correo electrónico</label>
                <div className="login-input-wrapper">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                    autoComplete="email"
                    required
                  />
                  <button
                    type="submit"
                    className="login-arrow-btn"
                    disabled={!email}
                    tabIndex={-1}
                    aria-label="Continuar"
                  >
                    <FiArrowRight size={18} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
              {error && <p className="login-error">{error}</p>}
            </form>

            <p className="login-register-link">
              ¿No tienes cuenta? <Link to="/register">Crear cuenta</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
