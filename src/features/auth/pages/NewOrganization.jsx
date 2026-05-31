import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../lib/apiFetch';
import { useUser } from '../../../contexts/UserContext';
import { useBlurValidation } from '../../../hooks/useBlurValidation';
import AuthCard from '../components/AuthCard';
import AuthLoading from '../components/AuthLoading';
import '../styles/auth.css';

// Mismo contrato de validación que el paso 2 de Register, para que ambos
// formularios de creación de organización se comporten igual.
function validate(form) {
  const errs = {};
  if (!(form.fincaNombre || '').trim()) errs.fincaNombre = 'Requerido.';
  if (!(form.nombreAdmin || '').trim()) errs.nombreAdmin = 'Requerido.';
  return errs;
}

export default function NewOrganization() {
  const navigate = useNavigate();
  const { firebaseUser, isLoading, isLoggedIn, selectFinca, refreshMemberships } = useUser();
  const [fincaNombre, setFincaNombre] = useState('');
  const [nombreAdmin, setNombreAdmin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const { fieldErrors, blurField, clearField, validateAll, inputClass } = useBlurValidation(validate);

  useEffect(() => {
    if (!isLoading && !firebaseUser) navigate('/login', { replace: true });
  }, [isLoading, firebaseUser, navigate]);

  // Navegar al panel principal cuando el contexto termine de cargar tras crear la org
  useEffect(() => {
    if (submitted && isLoggedIn) navigate('/', { replace: true });
  }, [submitted, isLoggedIn, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateAll({ fincaNombre, nombreAdmin })) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiFetch('/api/auth/register-finca', {
        method: 'POST',
        body: JSON.stringify({ fincaNombre, nombreAdmin }),
      });
      if (!res.ok) {
        let msg = 'Error al crear la organización. Intenta de nuevo.';
        try { msg = (await res.json()).message || msg; } catch { /* non-JSON response */ }
        throw new Error(msg);
      }
      const data = await res.json();
      await refreshMemberships();
      selectFinca(data.fincaId);
      setSubmitted(true);
      // Mantener submitting=true — el useEffect navegará cuando isLoggedIn resuelva
    } catch (err) {
      setError(err.message || 'Error al crear la organización.');
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <AuthCard>
        <AuthLoading text="Preparando tu organización..." />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Nueva organización" subtitle="Configura tu espacio de trabajo">
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="aur-field">
          <label htmlFor="finca-nombre" className="aur-field-label">Nombre de la organización</label>
          <input
            id="finca-nombre"
            type="text"
            className={inputClass('fincaNombre')}
            value={fincaNombre}
            onChange={(e) => { setFincaNombre(e.target.value); clearField('fincaNombre'); }}
            onBlur={() => blurField('fincaNombre', { fincaNombre, nombreAdmin })}
            placeholder="Ej: Hacienda El Sol"
            disabled={submitting}
            required
          />
          {fieldErrors.fincaNombre && (
            <span className="aur-field-error">{fieldErrors.fincaNombre}</span>
          )}
        </div>
        <div className="aur-field">
          <label htmlFor="nombre-admin" className="aur-field-label">Tu nombre</label>
          <input
            id="nombre-admin"
            type="text"
            className={inputClass('nombreAdmin')}
            value={nombreAdmin}
            onChange={(e) => { setNombreAdmin(e.target.value); clearField('nombreAdmin'); }}
            onBlur={() => blurField('nombreAdmin', { fincaNombre, nombreAdmin })}
            placeholder="Ej: Carlos Mendoza"
            disabled={submitting}
            required
          />
          {fieldErrors.nombreAdmin && (
            <span className="aur-field-error">{fieldErrors.nombreAdmin}</span>
          )}
        </div>
        {error && <p className="auth-error">{error}</p>}
        <button
          type="submit"
          className="aur-btn-pill auth-btn-submit"
          disabled={submitting || !fincaNombre || !nombreAdmin}
        >
          {submitting ? 'Creando...' : 'Crear organización'}
        </button>
      </form>

      <button className="aur-btn-text" onClick={() => navigate(-1)}>
        ← Volver
      </button>
    </AuthCard>
  );
}
