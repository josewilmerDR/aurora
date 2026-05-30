import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../../firebase';
import { useBlurValidation } from '../../../hooks/useBlurValidation';
import { isValidEmail } from '../../../lib/validators';
import AuthCard from '../components/AuthCard';
import '../styles/auth.css';

function validate(form) {
  const errs = {};
  const email = (form.email || '').trim();
  if (!email) errs.email = 'Ingresa tu correo electrónico.';
  else if (!isValidEmail(email)) errs.email = 'Email inválido.';
  return errs;
}

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { fieldErrors, blurField, clearField, validateAll, inputClass } = useBlurValidation(validate);
  const sentMsgRef = useRef(null);

  // Al pasar al estado de éxito el <form> se desmonta y el foco caería al
  // <body>; lo movemos al mensaje (role=status) para que un lector de pantalla
  // anuncie el resultado y el usuario de teclado no quede perdido.
  useEffect(() => {
    if (sent) sentMsgRef.current?.focus();
  }, [sent]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!validateAll({ email: cleanEmail })) return;
    setSubmitting(true);
    setError('');
    try {
      // continueUrl: tras restablecer, Firebase ofrece un botón para volver a
      // la app (/login) en vez de quedar varado en su pantalla genérica.
      await sendPasswordResetEmail(auth, cleanEmail, {
        url: `${window.location.origin}/login`,
      });
      setSent(true);
    } catch (err) {
      // Anti-enumeración: nunca revelamos si la cuenta existe. user-not-found
      // se trata como éxito → el usuario ve el mismo mensaje exista o no la
      // cuenta. Solo mostramos error en fallos reales del sistema.
      if (err.code === 'auth/user-not-found') {
        setSent(true);
      } else if (err.code === 'auth/too-many-requests') {
        setError('Demasiados intentos. Espera unos minutos.');
      } else {
        setError('No se pudo enviar el correo. Intenta de nuevo.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    clearField('email');
    if (error) setError(''); // limpiar el error de página al corregir, no esperar al submit
  };

  return (
    <AuthCard
      title={sent ? 'Revisa tu correo' : 'Recuperar contraseña'}
      subtitle={sent ? undefined : 'Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.'}
      footer={!sent && (
        <p className="auth-register-link">
          <Link to="/login">Volver al inicio de sesión</Link>
        </p>
      )}
    >
      {sent ? (
        <>
          <p className="auth-subtitle" ref={sentMsgRef} tabIndex={-1} role="status">
            Te enviamos un enlace a <strong>{email.trim()}</strong>. Revisa tu bandeja de entrada
            (y la carpeta de spam por si acaso).
          </p>
          <Link to="/login" className="aur-btn-pill auth-btn-submit">
            Volver al inicio de sesión
          </Link>
          <button type="button" className="auth-back-btn" onClick={() => setSent(false)}>
            <FiArrowLeft size={14} /> Usar otro correo
          </button>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="aur-field">
            <label htmlFor="email" className="aur-field-label">Correo electrónico</label>
            <input
              id="email"
              type="email"
              className={inputClass('email')}
              value={email}
              onChange={handleEmailChange}
              onBlur={() => blurField('email', { email })}
              placeholder="tu@correo.com"
              autoComplete="email"
              autoFocus
              disabled={submitting}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              required
            />
            {fieldErrors.email && <span id="email-error" className="aur-field-error">{fieldErrors.email}</span>}
          </div>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="aur-btn-pill auth-btn-submit" disabled={submitting || !email}>
            {submitting ? 'Enviando...' : 'Enviar enlace'}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
