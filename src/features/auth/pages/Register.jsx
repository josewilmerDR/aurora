import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createUserWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../../../firebase';
import { apiFetch, apiFetchJson } from '../../../lib/apiFetch';
import { useUser } from '../../../contexts/UserContext';
import { useBlurValidation } from '../../../hooks/useBlurValidation';
import { isValidEmail } from '../../../lib/validators';
import { authErrorMessage } from '../lib/authErrors';
import AuthCard from '../components/AuthCard';
import GoogleButton from '../components/GoogleButton';
import AuthLoading from '../components/AuthLoading';
import PasswordInput from '../components/PasswordInput';
import FincaForm from '../components/FincaForm';
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

export default function Register() {
  const navigate = useNavigate();
  const { refreshMemberships, selectFinca, isLoggedIn, needsSetup, needsOrgSelection } = useUser();

  const [step, setStep] = useState(1); // 1: account, 2: finca data
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  // Error del flujo de Google, separado del error de cuenta/finca: se pinta
  // justo debajo del botón que lo origina (mismo principio que Login), no
  // enterrado al fondo del form bajo campos no relacionados.
  const [googleError, setGoogleError] = useState('');

  const emailRef = useRef(null);
  const rulesRef = useRef(null);

  // Validación on-blur del paso de cuenta. El paso de finca usa <FincaForm>,
  // que trae su propia validación (la misma que /nueva-organizacion).
  const accountForm = { email, password, confirm };
  const accountValidation = useBlurValidation(validateAccountStep);

  // Foco inicial en el primer campo del paso 1 (igual que ForgotPassword/
  // LoginPassword). No corre con el spinner de Google; el paso 2 lo maneja
  // <FincaForm>, que enfoca su propio primer campo al montar.
  useEffect(() => {
    if (step === 1 && !googleLoading) emailRef.current?.focus();
  }, [step, googleLoading]);

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

  const passwordResults = PASSWORD_RULES.map((r) => r.test(password));
  const passwordValid = passwordResults.every(Boolean);

  // Step 1: validar cuenta y avanzar. La cuenta de Firebase se crea recién en el
  // paso 2 (a propósito): mantener al usuario sin autenticar durante el wizard
  // evita que needsOrgSelection lo redirija al OrganizationSelector antes de
  // tiempo. "Correo ya registrado" se detecta al crear la cuenta en el paso 2.
  const handleAccountStep = (e) => {
    e.preventDefault();
    if (!accountValidation.validateAll(accountForm)) return;
    if (!passwordValid) {
      // La checklist ya muestra qué falta; movemos el foco ahí en vez de
      // duplicar el feedback con un error de página redundante.
      rulesRef.current?.focus();
      return;
    }
    setError('');
    setStep(2);
  };

  // Step 2: create the email/password account (if not already authenticated via
  // Google) and the finca. <FincaForm> ya validó y trimeó los valores.
  const handleFincaStep = async ({ fincaNombre, nombreAdmin }) => {
    setSubmitting(true);
    setError('');
    try {
      // Only create email/password account if the user is NOT already authenticated (e.g. via Google)
      if (!auth.currentUser) {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
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
      const result = await apiFetchJson('/api/auth/register-finca', {
        method: 'POST',
        body: JSON.stringify({ fincaNombre, nombreAdmin }),
      });
      if (!result.ok) throw new Error(result.error); // error ya traducido al español
      // Seleccionar la finca recién creada ANTES de refrescar dispara la carga
      // de perfil en UserContext (igual que /nueva-organizacion); navegación a
      // cargo del useEffect que observa isLoggedIn.
      selectFinca(result.data.fincaId);
      await refreshMemberships();
    } catch (err) {
      const code = err.code;
      console.error('[Register] error code:', code, 'message:', err.message);
      if (code === 'auth/email-already-in-use') {
        // La cuenta ya existe: no tiene sentido crear una org, debe iniciar
        // sesión. Volvemos al paso 1 con el correo intacto.
        setError('Este correo ya está registrado. Inicia sesión.');
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
    setGoogleError('');
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
      // Keep loading state — useEffect will navigate or go to step 2 when needsSetup resolves
    } catch (err) {
      setGoogleLoading(false);
      // El usuario cerró/canceló el popup: no es un error que mostrar.
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
      setGoogleError(authErrorMessage(err.code, 'No se pudo continuar con Google.'));
    }
  };

  if (step === 1 && googleLoading) {
    return (
      <AuthCard>
        <AuthLoading text="Conectando con Google…" />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Crear cuenta"
      subtitle={step === 1 ? 'Ingresa tus credenciales' : 'Configura tu organización'}
      footer={step === 1 && (
        <p className="auth-register-link">
          ¿Ya tienes cuenta? <Link to="/login">Iniciar sesión</Link>
        </p>
      )}
    >
      <p className="auth-step">Paso {step} de 2</p>

      {step === 1 && (
        <>
          <GoogleButton onClick={handleGoogle} disabled={googleLoading} loading={googleLoading} />

          {/* Error de Google: justo debajo del botón que lo origina, no
              enterrado al fondo del form bajo campos no relacionados. */}
          {googleError && <p className="auth-error" role="alert">{googleError}</p>}

          <div className="auth-divider"><span>o</span></div>

          <form onSubmit={handleAccountStep} className="auth-form" noValidate>
            <div className="aur-field">
              <label htmlFor="email" className="aur-field-label">Correo electrónico</label>
              <input
                ref={emailRef}
                id="email"
                type="email"
                className={accountValidation.inputClass('email')}
                value={email}
                onChange={(e) => { setEmail(e.target.value); accountValidation.clearField('email'); if (googleError) setGoogleError(''); }}
                onBlur={() => accountValidation.blurField('email', accountForm)}
                placeholder="tu@correo.com"
                autoComplete="email"
                aria-invalid={!!accountValidation.fieldErrors.email}
                aria-describedby={accountValidation.fieldErrors.email ? 'email-error' : undefined}
                required
              />
              {accountValidation.fieldErrors.email && (
                <span id="email-error" className="aur-field-error">{accountValidation.fieldErrors.email}</span>
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
                <ul
                  className="auth-password-rules"
                  ref={rulesRef}
                  tabIndex={-1}
                  aria-live="polite"
                  aria-label="Requisitos de la contraseña"
                >
                  {PASSWORD_RULES.map((r, i) => (
                    <li
                      key={r.id}
                      className={passwordResults[i] ? 'auth-rule-ok' : 'auth-rule-fail'}
                      aria-label={`${passwordResults[i] ? 'Cumple' : 'Falta'}: ${r.label}`}
                    >
                      {passwordResults[i] ? '✓' : '✗'} {r.label}
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
                aria-invalid={!!accountValidation.fieldErrors.confirm}
                aria-describedby={accountValidation.fieldErrors.confirm ? 'confirm-error' : undefined}
                required
              />
              {accountValidation.fieldErrors.confirm && (
                <span id="confirm-error" className="aur-field-error">{accountValidation.fieldErrors.confirm}</span>
              )}
            </div>

            {error && <p className="auth-error" role="alert">{error}</p>}

            <button
              type="submit"
              className="aur-btn-pill auth-btn-submit"
              disabled={!email || !password || !confirm}
            >
              Continuar
            </button>
          </form>
        </>
      )}

      {step === 2 && (
        <FincaForm
          onSubmit={handleFincaStep}
          submitting={submitting}
          error={error}
          onDirty={() => { if (error) setError(''); }}
        />
      )}
    </AuthCard>
  );
}
