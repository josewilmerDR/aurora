import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';
import { sendEmailVerification } from 'firebase/auth';
import { auth } from '../../../firebase';
import { useUser } from '../../../contexts/UserContext';
import { authErrorMessage } from '../lib/authErrors';
import AuthCard from '../components/AuthCard';
import '../styles/auth.css';

// Polling cadence while we wait for the user to click the verification link.
// Firebase bakes email_verified into the cached ID token, so we reload() the
// user on an interval; refreshAfterVerification() forces the token refresh
// once verified. 4s is responsive without hammering the Auth backend.
const POLL_INTERVAL_MS = 4000;
// Cooldown before "Reenviar" can fire again — Firebase throttles aggressively
// (auth/too-many-requests) and a chatty button would trip it.
const RESEND_COOLDOWN_S = 60;

export default function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { firebaseUser, emailVerified, refreshAfterVerification, logout } = useUser();

  // Email to display: prefer router state (set by Register/LoginPassword), fall
  // back to the live Firebase user.
  const email = location.state?.email || firebaseUser?.email || auth.currentUser?.email || '';

  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Shared verification check: reload the user, and if verified, hydrate the
  // session and leave for home (ProtectedRoute decides org-selection vs app).
  const checkVerified = useCallback(async () => {
    try {
      const verified = await refreshAfterVerification();
      if (verified && mountedRef.current) {
        navigate('/', { replace: true });
        return true;
      }
    } catch {
      // Transient (network / token). The poller will try again.
    }
    return false;
  }, [refreshAfterVerification, navigate]);

  // Poll while mounted. Also runs once on mount, which covers the case where
  // the user verified in this same browser (continueUrl returns here) — the
  // first tick detects it without waiting for a click.
  useEffect(() => {
    if (!auth.currentUser) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await checkVerified();
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [checkVerified]);

  // Cooldown countdown for the resend button.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const handleManualCheck = async () => {
    setChecking(true);
    setError('');
    setInfo('');
    const ok = await checkVerified();
    if (!ok && mountedRef.current) {
      setChecking(false);
      setInfo('Todavía no detectamos la verificación. Revisa tu correo y vuelve a intentar.');
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || !auth.currentUser) return;
    setError('');
    setInfo('');
    try {
      await sendEmailVerification(auth.currentUser, {
        url: `${window.location.origin}/verificar-correo`,
      });
      setInfo('Te reenviamos el correo de verificación.');
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      if (err.code === 'auth/too-many-requests') {
        setError('Demasiados intentos. Espera unos minutos antes de reenviar.');
        setCooldown(RESEND_COOLDOWN_S);
      } else {
        setError(authErrorMessage(err.code, 'No se pudo reenviar el correo. Intenta de nuevo.'));
      }
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // No Firebase session at all → nothing to verify. Back to login.
  if (!auth.currentUser) return <Navigate to="/login" replace />;
  // Already verified (e.g. landed here by accident) → let the app route.
  if (emailVerified) return <Navigate to="/" replace />;

  return (
    <AuthCard
      title="Verifica tu correo"
      subtitle={
        email
          ? <>Te enviamos un enlace de verificación a <strong>{email}</strong>. Ábrelo para activar tu cuenta.</>
          : 'Te enviamos un enlace de verificación. Ábrelo para activar tu cuenta.'
      }
      footer={
        <p className="auth-register-link">
          <button type="button" className="aur-btn-text" onClick={handleLogout}>
            Usar otro correo
          </button>
        </p>
      }
    >
      <div className="auth-form" aria-live="polite">
        <p className="auth-subtitle">
          Una vez que hagas clic en el enlace, esta pantalla continuará automáticamente.
          También puedes revisar la carpeta de spam.
        </p>

        {error && <p className="auth-error" role="alert">{error}</p>}
        {info && !error && <p className="auth-subtitle" role="status">{info}</p>}

        <button
          type="button"
          className="aur-btn-pill auth-btn-submit"
          onClick={handleManualCheck}
          disabled={checking}
        >
          {checking ? 'Verificando…' : 'Ya verifiqué mi correo'}
        </button>

        <button
          type="button"
          className="auth-back-btn"
          onClick={handleResend}
          disabled={cooldown > 0}
        >
          {cooldown > 0 ? `Reenviar correo (${cooldown}s)` : 'Reenviar correo'}
        </button>
      </div>
    </AuthCard>
  );
}
