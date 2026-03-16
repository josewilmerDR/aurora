import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/apiFetch';
import { useUser } from '../contexts/UserContext';
import './Login.css';

export default function NuevaOrganizacion() {
  const navigate = useNavigate();
  const { firebaseUser, isLoading, selectFinca, refreshMemberships } = useUser();
  const [fincaNombre, setFincaNombre] = useState('');
  const [nombreAdmin, setNombreAdmin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && !firebaseUser) navigate('/login', { replace: true });
  }, [isLoading, firebaseUser, navigate]);

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
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Error al crear la organización.');
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

        <h2 className="login-title">Nueva organización</h2>
        <p className="login-subtitle">Configura tu espacio de trabajo</p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label htmlFor="finca-nombre">Nombre de la organización</label>
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
          <button
            type="submit"
            className="login-btn"
            disabled={submitting || !fincaNombre || !nombreAdmin}
          >
            {submitting ? 'Creando...' : 'Crear organización'}
          </button>
        </form>

        <button className="login-register-link-btn" onClick={() => navigate(-1)}>
          ← Volver
        </button>
      </div>
    </div>
  );
}
