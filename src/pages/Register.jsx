import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createUserWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import { auth, googleProvider } from '../firebase';
import { apiFetch } from '../lib/apiFetch';
import { useUser } from '../contexts/UserContext';
import './Login.css';

const PASSWORD_RULES = [
  { id: 'length',    label: 'Mínimo 8 caracteres',        test: (p) => p.length >= 8 },
  { id: 'upper',     label: 'Una letra mayúscula',         test: (p) => /[A-Z]/.test(p) },
  { id: 'lower',     label: 'Una letra minúscula',         test: (p) => /[a-z]/.test(p) },
  { id: 'number',    label: 'Un número',                   test: (p) => /[0-9]/.test(p) },
];

export default function Register() {
  const navigate = useNavigate();
  const { refreshMemberships, isLoggedIn, needsSetup } = useUser();

  const [step, setStep] = useState(1); // 1: cuenta, 2: datos de la finca
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fincaNombre, setFincaNombre] = useState('');
  const [nombreAdmin, setNombreAdmin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Navegar al dashboard en cuanto el login esté completo (currentUser cargado),
  // o ir a step 2 si el usuario ya se autenticó pero aún no tiene finca
  // (cubre el caso de redirect de Google que recarga la página)
  useEffect(() => {
    if (isLoggedIn) navigate('/', { replace: true });
    else if (needsSetup && step === 1) {
      // Antes de mostrar el formulario de creación de organización,
      // intentar reclamar membresías pendientes (usuario fue agregado por un admin previamente)
      apiFetch('/api/auth/claim-invitations', { method: 'POST' })
        .then(res => res.ok ? res.json() : { memberships: [] })
        .then(async (data) => {
          if (data.memberships?.length > 0) {
            // Tiene invitaciones → recargar membresías, isLoggedIn se volverá true y navegará a /
            await refreshMemberships();
          } else {
            setStep(2);
          }
        })
        .catch(() => setStep(2));
    }
  }, [isLoggedIn, needsSetup, step, navigate, refreshMemberships]);

  const passwordValid = PASSWORD_RULES.every(r => r.test(password));

  // Paso 1: crear cuenta con email/password
  const handleAccountStep = (e) => {
    e.preventDefault();
    if (!passwordValid) {
      setError('La contraseña no cumple los requisitos de seguridad.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setError('');
    setStep(2);
  };

  // Paso 2: crear la finca en el backend
  const handleFincaStep = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      // Solo crear cuenta email/password si el usuario NO está ya autenticado (ej. con Google)
      if (!auth.currentUser) {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      // Crear finca en el backend (el middleware usa el token recién creado)
      const res = await apiFetch('/api/auth/register-finca', {
        method: 'POST',
        body: JSON.stringify({ fincaNombre, nombreAdmin }),
      });
      if (!res.ok) {
        let msg = 'Error al crear la finca. Intenta de nuevo.';
        try { msg = (await res.json()).message || msg; } catch { /* respuesta no es JSON (emulador en cold start) */ }
        throw new Error(msg);
      }
      // Recargar membresías para que UserContext sepa que ya hay finca → isLoggedIn = true
      // La navegación la maneja el useEffect que observa isLoggedIn
      await refreshMemberships();
    } catch (err) {
      const code = err.code;
      console.error('[Register] error code:', code, 'message:', err.message);
      if (code === 'auth/email-already-in-use') {
        setError('Este correo ya está registrado.');
        setStep(1);
      } else {
        setError(err.message || 'Error al crear la cuenta. Intenta de nuevo.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Registrarse con Google (directo al paso 2)
  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
      // Mantener estado de carga — el useEffect navegará o irá al paso 2 cuando needsSetup resuelva
    } catch (err) {
      setGoogleLoading(false);
      if (err.code === 'auth/account-exists-with-different-credential' || err.code === 'auth/email-already-in-use') {
        setError('Este correo ya tiene contraseña. Ingresa con correo y contraseña, luego vincula Google desde Mi perfil.');
      } else if (err.code !== 'auth/popup-closed-by-user') {
        setError('No se pudo continuar con Google.');
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

        <h2 className="login-title">Crear cuenta</h2>
        <p className="login-subtitle">
          {step === 1 ? 'Ingresa tus credenciales' : 'Configura tu organización'}
        </p>

        {step === 1 && (
          googleLoading ? (
            <div className="login-google-loading">
              <div className="login-google-spinner" />
              <p className="login-google-loading-text">Verificando cuenta...</p>
            </div>
          ) : (
          <>
            <button className="login-btn-google" onClick={handleGoogle} disabled={submitting}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continuar con Google
            </button>

            <div className="login-divider"><span>o</span></div>

            <form onSubmit={handleAccountStep} className="login-form">
              <div className="login-field">
                <label htmlFor="email">Correo electrónico</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="login-field">
                <label htmlFor="password">Contraseña</label>
                <div className="login-input-wrapper">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    autoComplete="new-password"
                    required
                  />
                  <button type="button" className="login-eye-btn" onClick={() => setShowPassword(v => !v)} tabIndex={-1}>
                    {showPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                  </button>
                </div>
                {password && (
                  <ul className="password-rules">
                    {PASSWORD_RULES.map(r => (
                      <li key={r.id} className={r.test(password) ? 'rule-ok' : 'rule-fail'}>
                        {r.test(password) ? '✓' : '✗'} {r.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="login-field">
                <label htmlFor="confirm">Confirmar contraseña</label>
                <div className="login-input-wrapper">
                  <input
                    id="confirm"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repite la contraseña"
                    required
                  />
                  <button type="button" className="login-eye-btn" onClick={() => setShowConfirm(v => !v)} tabIndex={-1}>
                    {showConfirm ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                  </button>
                </div>
              </div>
              {error && <p className="login-error">{error}</p>}
              <button type="submit" className="login-btn" disabled={!email || !password || !confirm}>
                Siguiente
              </button>
            </form>
          </>
          )
        )}

        {step === 2 && (
          <form onSubmit={handleFincaStep} className="login-form">
            <div className="login-field">
              <label htmlFor="finca-nombre">Nombre de tu organización</label>
              <input
                id="finca-nombre"
                type="text"
                value={fincaNombre}
                onChange={(e) => setFincaNombre(e.target.value)}
                placeholder="Ej: Hacienda El Sol"
                disabled={submitting}
                required
              />
            </div>
            <div className="login-field">
              <label htmlFor="nombre-admin">Tu nombre</label>
              <input
                id="nombre-admin"
                type="text"
                value={nombreAdmin}
                onChange={(e) => setNombreAdmin(e.target.value)}
                placeholder="Ej: Carlos Mendoza"
                disabled={submitting}
                required
              />
            </div>
            {error && <p className="login-error">{error}</p>}
            <button type="submit" className="login-btn" disabled={submitting || !fincaNombre || !nombreAdmin}>
              {submitting ? 'Creando cuenta...' : 'Crear organización'}
            </button>
          </form>
        )}

        <p className="login-register-link">
          ¿Ya tienes cuenta? <Link to="/login">Iniciar sesión</Link>
        </p>
      </div>
    </div>
  );
}
