import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';
import { apiFetchJson } from '../../../lib/apiFetch';
import { useUser } from '../../../contexts/UserContext';
import AuthCard from '../components/AuthCard';
import AuthLoading from '../components/AuthLoading';
import FincaForm from '../components/FincaForm';
import '../styles/auth.css';

// Si tras crear la org el perfil no carga (/api/auth/me falla por cold start,
// red, etc.), isLoggedIn nunca resuelve y el spinner quedaría colgado para
// siempre. Pasado este tiempo mostramos una salida manual.
const STUCK_TIMEOUT_MS = 10000;

export default function NewOrganization() {
  const navigate = useNavigate();
  const { firebaseUser, isLoading, isLoggedIn, selectFinca, refreshMemberships } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [error, setError] = useState('');

  // Solo bloqueamos el acceso de usuarios sin sesión. La ruta es pública: un
  // usuario logueado SIN finca activa cae en OrganizationSelector vía
  // ProtectedRoute, así que necesita esta ruta para crear su primera org.
  useEffect(() => {
    if (!isLoading && !firebaseUser) navigate('/login', { replace: true });
  }, [isLoading, firebaseUser, navigate]);

  // Navegar al panel cuando el contexto termine de cargar el perfil tras crear
  // la org; si nunca resuelve, destrabar con el fallback (ver STUCK_TIMEOUT_MS).
  useEffect(() => {
    if (!submitted) return;
    if (isLoggedIn) {
      navigate('/', { replace: true });
      return;
    }
    const t = setTimeout(() => setStuck(true), STUCK_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [submitted, isLoggedIn, navigate]);

  const handleCreate = async ({ fincaNombre, nombreAdmin }) => {
    setSubmitting(true);
    setError('');
    const result = await apiFetchJson('/api/auth/register-finca', {
      method: 'POST',
      body: JSON.stringify({ fincaNombre, nombreAdmin }),
    });
    if (!result.ok) {
      setError(result.error); // ya traducido al español por translateApiError
      setSubmitting(false);
      return;
    }
    // Seleccionar la finca recién creada ANTES de refrescar: dispara la carga
    // de perfil en UserContext sin depender de cuántas membresías haya.
    selectFinca(result.data.fincaId);
    await refreshMemberships();
    setSubmitted(true);
    // Mantener submitting=true — el useEffect navega cuando isLoggedIn resuelva.
  };

  // Carga inicial mientras el contexto resuelve la sesión, para no parpadear el
  // formulario antes del posible redirect a /login.
  if (isLoading) {
    return (
      <AuthCard>
        <AuthLoading />
      </AuthCard>
    );
  }

  if (submitted) {
    if (stuck && !isLoggedIn) {
      return (
        <AuthCard title="Tu organización está lista" subtitle="No pudimos abrir el panel automáticamente.">
          <button
            className="aur-btn-pill auth-btn-submit"
            onClick={() => navigate('/', { replace: true })}
          >
            Ir a mi organización
          </button>
        </AuthCard>
      );
    }
    return (
      <AuthCard>
        <AuthLoading text="Preparando tu organización..." />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Nueva organización" subtitle="Configura tu espacio de trabajo">
      <FincaForm
        onSubmit={handleCreate}
        submitting={submitting}
        error={error}
        onDirty={() => { if (error) setError(''); }}
      />

      <button type="button" className="auth-back-btn" onClick={() => navigate('/')}>
        <FiArrowLeft size={14} /> Volver
      </button>
    </AuthCard>
  );
}
