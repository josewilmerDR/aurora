import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../../firebase';
import { useBlurValidation } from '../../../hooks/useBlurValidation';
import AuthCard from '../components/AuthCard';
import '../styles/auth.css';

function validate(form) {
  const errs = {};
  const email = (form.email || '').trim();
  if (!email) errs.email = 'Ingresa tu correo electrónico.';
  else if (!email.includes('@') || !email.includes('.')) errs.email = 'Email inválido.';
  return errs;
}

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { fieldErrors, blurField, clearField, validateAll, inputClass } = useBlurValidation(validate);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateAll({ email })) return;
    setSubmitting(true);
    setError('');
    try {
      await sendPasswordResetEmail(auth, email);
      setSent(true);
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') {
        setError('No encontramos una cuenta con ese correo.');
      } else {
        setError('No se pudo enviar el correo. Intenta de nuevo.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Recuperar contraseña"
      footer={!sent && (
        <p className="auth-register-link">
          <Link to="/login">Volver al inicio de sesión</Link>
        </p>
      )}
    >
      {sent ? (
        <>
          <p className="auth-subtitle">
            Te enviamos un enlace a <strong>{email}</strong>. Revisa tu bandeja de entrada
            (y la carpeta de spam por si acaso).
          </p>
          <Link to="/login" className="aur-btn-pill auth-btn-submit">
            Volver al inicio de sesión
          </Link>
        </>
      ) : (
        <>
          <p className="auth-subtitle">
            Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
          </p>
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="aur-field">
              <label htmlFor="email" className="aur-field-label">Correo electrónico</label>
              <input
                id="email"
                type="email"
                className={inputClass('email')}
                value={email}
                onChange={(e) => { setEmail(e.target.value); clearField('email'); }}
                onBlur={() => blurField('email', { email })}
                placeholder="tu@correo.com"
                autoComplete="email"
                disabled={submitting}
                required
              />
              {fieldErrors.email && <span className="aur-field-error">{fieldErrors.email}</span>}
            </div>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="aur-btn-pill auth-btn-submit" disabled={submitting || !email}>
              {submitting ? 'Enviando...' : 'Enviar enlace'}
            </button>
          </form>
        </>
      )}
    </AuthCard>
  );
}
