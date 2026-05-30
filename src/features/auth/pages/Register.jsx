import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createUserWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../../../firebase';
import { apiFetch } from '../../../lib/apiFetch';
import { useUser } from '../../../contexts/UserContext';
import { useBlurValidation } from '../../../hooks/useBlurValidation';
import { isValidEmail } from '../../../lib/validators';
import AuthCard from '../components/AuthCard';
import GoogleButton from '../components/GoogleButton';
import AuthLoading from '../components/AuthLoading';
import PasswordInput from '../components/PasswordInput';
import '../styles/auth.css';

// Tras Google en step 1 mantenemos el spinner esperando a que UserContext
// resuelva. Si el perfil nunca carga, sin este tope el usuario queda colgado;
// a los 15s liberamos el spinner con un error accionable.
const PROFILE_TIMEOUT_MS = 15000;

const PASSWORD_RULES = [
  { id: 'length', label: 'Mínimo 8 caracteres', test: (p) => p.length >= 8 },
  { id: 'upper',  label: 'Una letra mayúscula', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower',  label: 'Una letra minúscula', test: (p) => /[a-z]/.test(p) },
  { id: 'number', label: 'Un número',           test: (p) => /[0-9]/.test(p) },
];

// Validación a nivel de campo para feedback on-blur. La contraseña no entra
// aquí — el rule list (PASSWORD_RULES) ya provee feedback más rico campo a
// campo. Confirm solo se valida cuando el usuario tipeó la contraseña, así
// el primer blur no se queja antes de tiempo.
function validateAccountStep(form) {
  const errs = {};
  const email = (form.email || '').trim();
  if (!email) errs.email = 'Ingresa tu correo electrónico.';
  else if (!isValidEmail(email)) errs.email = 'Email inválido.';
  if (form.password && form.confirm && form.password !== form.confirm) {
    errs.confirm = 'No coincide con la contraseña.';
  }
  return errs;
}

function validateFincaStep(form) {
  const errs = {};
  if (!(form.fincaNombre || '').trim()) errs.fincaNombre = 'Requerido.';
  if (!(form.nombreAdmin || '').trim()) errs.nombreAdmin = 'Requerido.';
  return errs;
}

export default function Register() {
  const navigate = useNavigate();
  const { refreshMemberships, isLoggedIn, needsSetup, needsOrgSelection } = useUser();

  const [step, setStep] = useState(1); // 1: account, 2: finca data
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fincaNombre, setFincaNombre] = useState('');
  const [nombreAdmin, setNombreAdmin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  // Dos hooks separados — uno por paso del wizard — para que validateAll
  // del paso 2 no falle por errores que viven en el paso 1 (email vacío
  // queda invisible una vez que el usuario avanzó).
  const accountForm = { email, password, confirm };
  const accountValidation = useBlurValidation(validateAccountStep);
  const fincaForm = { fincaNombre, nombreAdmin };
  const fincaValidation = useBlurValidation(validateFincaStep);

  // Navigate to dashboard once login is complete (currentUser loaded),
  // or to OrganizationSelector if the user has memberships but no active finca
  // (covers Google sign-in where UserContext already claimed pending invitations)
  useEffect(() => {
    if (isLoggedIn) navigate('/', { replace: true });
    else if (needsOrgSelection) navigate('/', { replace: true });
    else if (needsSetup && step === 1) {
      // Before showing the organization creation form,
      // attempt to claim pending memberships (user was previously added by an admin)
      apiFetch('/api/auth/claim-invitations', { method: 'POST' })
        .then(res => res.ok ? res.json() : { memberships: [] })
        .then(async (data) => {
          if (data.memberships?.length > 0) {
            // Has invitations → reload memberships, isLoggedIn becomes true and navigates to /
            await refreshMemberships();
          } else {
            setStep(2);
            setGoogleLoading(false); // resolvió: dejamos de esperar a Google
          }
        })
        .catch(() => { setStep(2); setGoogleLoading(false); });
    }
  }, [isLoggedIn, needsOrgSelection, needsSetup, step, navigate, refreshMemberships]);

  // Tope anti-cuelgue del spinner de Google (ver PROFILE_TIMEOUT_MS). Al pasar
  // a step 2 las deps cambian y el cleanup descarta el timer, así que nunca
  // dispara un error tras una transición legítima.
  useEffect(() => {
    if (!(step === 1 && googleLoading)) return undefined;
    const t = setTimeout(() => {
      setGoogleLoading(false);
      setError('No pudimos cargar tu perfil. Intenta de nuevo.');
    }, PROFILE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [step, googleLoading]);

  const passwordValid = PASSWORD_RULES.every(r => r.test(password));

  // Step 1: create account with email/password
  const handleAccountStep = (e) => {
    e.preventDefault();
    // Per-field errors (email format, confirm matches password) — el rule
    // list cubre password aparte, así que su validez sigue siendo gate
    // separado.
    if (!accountValidation.validateAll(accountForm)) return;
    if (!passwordValid) {
      setError('La contraseña no cumple los requisitos de seguridad.');
      return;
    }
    setError('');
    setStep(2);
  };

  // Step 2: create the finca in the backend
  const handleFincaStep = async (e) => {
    e.preventDefault();
    if (!fincaValidation.validateAll(fincaForm)) return;
    setSubmitting(true);
    setError('');
    try {
      // Only create email/password account if the user is NOT already authenticated (e.g. via Google)
      if (!auth.currentUser) {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      // Check for pending invitations BEFORE creating a new organization.
      // If the user was previously added by an admin, they should not create a new org.
      const claimRes = await apiFetch('/api/auth/claim-invitations', { method: 'POST' });
      if (claimRes.ok) {
        const claimData = await claimRes.json();
        if (claimData.memberships?.length > 0) {
          // Has invitations → reload memberships and let useEffect navigate
          await refreshMemberships();
          return;
        }
      }
      // No invitations → create the requested organization
      const res = await apiFetch('/api/auth/register-finca', {
        method: 'POST',
        body: JSON.stringify({ fincaNombre, nombreAdmin }),
      });
      if (!res.ok) {
        let msg = 'Error al crear la finca. Intenta de nuevo.';
        try { msg = (await res.json()).message || msg; } catch { /* response is not JSON (emulator cold start) */ }
        throw new Error(msg);
      }
      // Reload memberships so UserContext knows there is a finca → isLoggedIn = true
      // Navigation is handled by the useEffect that watches isLoggedIn
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

  // Register with Google (goes directly to step 2)
  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
      // Keep loading state — useEffect will navigate or go to step 2 when needsSetup resolves
    } catch (err) {
      setGoogleLoading(false);
      if (err.code === 'auth/account-exists-with-different-credential' || err.code === 'auth/email-already-in-use') {
        setError('Este correo ya tiene contraseña. Ingresa con correo y contraseña, luego vincula Google desde Mi perfil.');
      } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setError('No se pudo continuar con Google.');
      }
    }
  };

  if (step === 1 && googleLoading) {
    return (
      <AuthCard>
        <AuthLoading />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Crear cuenta"
      subtitle={step === 1 ? 'Ingresa tus credenciales' : 'Configura tu organización'}
      footer={
        <p className="auth-register-link">
          ¿Ya tienes cuenta? <Link to="/login">Iniciar sesión</Link>
        </p>
      }
    >
      {step === 1 && (
        <>
          <GoogleButton onClick={handleGoogle} disabled={submitting} loading={googleLoading} />

          <div className="auth-divider"><span>o</span></div>

          <form onSubmit={handleAccountStep} className="auth-form">
            <div className="aur-field">
              <label htmlFor="email" className="aur-field-label">Correo electrónico</label>
              <input
                id="email"
                type="email"
                className={accountValidation.inputClass('email')}
                value={email}
                onChange={(e) => { setEmail(e.target.value); accountValidation.clearField('email'); }}
                onBlur={() => accountValidation.blurField('email', accountForm)}
                placeholder="tu@correo.com"
                autoComplete="email"
                required
              />
              {accountValidation.fieldErrors.email && (
                <span className="aur-field-error">{accountValidation.fieldErrors.email}</span>
              )}
            </div>

            <div className="aur-field">
              <label htmlFor="password" className="aur-field-label">Contraseña</label>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
                required
              />
              {password && (
                <ul className="auth-password-rules">
                  {PASSWORD_RULES.map(r => (
                    <li key={r.id} className={r.test(password) ? 'auth-rule-ok' : 'auth-rule-fail'}>
                      {r.test(password) ? '✓' : '✗'} {r.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="aur-field">
              <label htmlFor="confirm" className="aur-field-label">Confirmar contraseña</label>
              <PasswordInput
                id="confirm"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); accountValidation.clearField('confirm'); }}
                onBlur={() => accountValidation.blurField('confirm', accountForm)}
                className={accountValidation.inputClass('confirm')}
                placeholder="Repite la contraseña"
                autoComplete="new-password"
                required
              />
              {accountValidation.fieldErrors.confirm && (
                <span className="aur-field-error">{accountValidation.fieldErrors.confirm}</span>
              )}
            </div>

            {error && <p className="auth-error" role="alert">{error}</p>}

            <button
              type="submit"
              className="aur-btn-pill auth-btn-submit"
              disabled={!email || !password || !confirm}
            >
              Siguiente
            </button>
          </form>
        </>
      )}

      {step === 2 && (
        <form onSubmit={handleFincaStep} className="auth-form">
          <div className="aur-field">
            <label htmlFor="finca-nombre" className="aur-field-label">Nombre de tu organización</label>
            <input
              id="finca-nombre"
              type="text"
              className={fincaValidation.inputClass('fincaNombre')}
              value={fincaNombre}
              onChange={(e) => { setFincaNombre(e.target.value); fincaValidation.clearField('fincaNombre'); }}
              onBlur={() => fincaValidation.blurField('fincaNombre', fincaForm)}
              placeholder="Ej: Hacienda El Sol"
              disabled={submitting}
              required
            />
            {fincaValidation.fieldErrors.fincaNombre && (
              <span className="aur-field-error">{fincaValidation.fieldErrors.fincaNombre}</span>
            )}
          </div>
          <div className="aur-field">
            <label htmlFor="nombre-admin" className="aur-field-label">Tu nombre</label>
            <input
              id="nombre-admin"
              type="text"
              className={fincaValidation.inputClass('nombreAdmin')}
              value={nombreAdmin}
              onChange={(e) => { setNombreAdmin(e.target.value); fincaValidation.clearField('nombreAdmin'); }}
              onBlur={() => fincaValidation.blurField('nombreAdmin', fincaForm)}
              placeholder="Ej: Carlos Mendoza"
              disabled={submitting}
              required
            />
            {fincaValidation.fieldErrors.nombreAdmin && (
              <span className="aur-field-error">{fincaValidation.fieldErrors.nombreAdmin}</span>
            )}
          </div>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button
            type="submit"
            className="aur-btn-pill auth-btn-submit"
            disabled={submitting || !fincaNombre || !nombreAdmin}
          >
            {submitting ? 'Creando cuenta...' : 'Crear organización'}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
