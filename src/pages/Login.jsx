import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import './Login.css';

export default function Login() {
  const { login, isLoggedIn } = useUser();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/', { replace: true });
      return;
    }
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => {
        setUsers(data);
        if (data.length > 0) setSelectedId(data[0].id);
      })
      .catch(() => setError('No se pudo cargar la lista de usuarios.'))
      .finally(() => setLoading(false));
  }, [isLoggedIn, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedId) return;
    setSubmitting(true);
    setError('');
    try {
      await login(selectedId);
      navigate('/', { replace: true });
    } catch {
      setError('No se pudo iniciar sesión. Intenta de nuevo.');
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

        <h2 className="login-title">Bienvenido</h2>
        <p className="login-subtitle">Selecciona tu usuario para continuar</p>

        {loading ? (
          <p className="login-loading">Cargando usuarios...</p>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="user-select">¿Quién eres?</label>
              <select
                id="user-select"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                disabled={submitting}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="login-error">{error}</p>}

            <button type="submit" className="login-btn" disabled={submitting || !selectedId}>
              {submitting ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
