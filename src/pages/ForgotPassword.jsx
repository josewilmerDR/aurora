import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase';
import './Login.css';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
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
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-logo-text">AU</span>
          <span className="login-logo-label">Aurora</span>
        </div>

        <h2 className="login-title">Recuperar contraseña</h2>

        {sent ? (
          <>
            <p className="login-subtitle">
              Te enviamos un enlace a <strong>{email}</strong>. Revisa tu bandeja de entrada
              (y la carpeta de spam por si acaso).
            </p>
            <Link to="/login" className="login-btn" style={{ display: 'block', textAlign: 'center', marginTop: '1.5rem' }}>
              Volver al inicio de sesión
            </Link>
          </>
        ) : (
          <>
            <p className="login-subtitle">
              Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
            </p>
            <form onSubmit={handleSubmit} className="login-form">
              <div className="login-field">
                <label htmlFor="email">Correo electrónico</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  autoComplete="email"
                  disabled={submitting}
                  required
                />
              </div>
              {error && <p className="login-error">{error}</p>}
              <button type="submit" className="login-btn" disabled={submitting || !email}>
                {submitting ? 'Enviando...' : 'Enviar enlace'}
              </button>
            </form>
            <p className="login-register-link">
              <Link to="/login">Volver al inicio de sesión</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
