import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../lib/apiFetch';
import { useUser } from '../../../contexts/UserContext';
import AuthCard from '../components/AuthCard';
import AuthLoading from '../components/AuthLoading';
import '../styles/auth.css';

export default function NewOrganization() {
  const navigate = useNavigate();
  const { firebaseUser, isLoading, isLoggedIn, selectFinca, refreshMemberships } = useUser();
  const [fincaNombre, setFincaNombre] = useState('');
  const [nombreAdmin, setNombreAdmin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && !firebaseUser) navigate('/login', { replace: true });
  }, [isLoading, firebaseUser, navigate]);

  // Navegar al panel principal cuando el contexto termine de cargar tras crear la org
  useEffect(() => {
    if (submitted && isLoggedIn) navigate('/', { replace: true });
  }, [submitted, isLoggedIn, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
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
            className="aur-input"
            value={fincaNombre}
            onChange={(e) => setFincaNombre(e.target.value)}
            placeholder="Ej: Hacienda El Sol"
            disabled={submitting}
            required
          />
        </div>
        <div className="aur-field">
          <label htmlFor="nombre-admin" className="aur-field-label">Tu nombre</label>
          <input
            id="nombre-admin"
            type="text"
            className="aur-input"
            value={nombreAdmin}
            onChange={(e) => setNombreAdmin(e.target.value)}
            placeholder="Ej: Carlos Mendoza"
            disabled={submitting}
            required
          />
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
