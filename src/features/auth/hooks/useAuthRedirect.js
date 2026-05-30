import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../../contexts/UserContext';

// Guard anti open-redirect: `from` viene de location.state (lo setea
// ProtectedRoute con una ruta interna), pero sólo aceptamos paths internos
// que arrancan con '/' y no con '//' (que el browser interpreta como host
// externo). Cualquier otra cosa cae a la home.
export function safeRedirectPath(raw) {
  if (typeof raw !== 'string') return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

// Triángulo de navegación post-auth compartido por Login y LoginPassword
// (antes duplicado verbatim en ambas). Register NO lo usa: tiene lógica propia
// porque en needsSetup intenta reclamar invitaciones antes de mostrar el form
// de organización.
//
// Destinos:
//   isLoggedIn        → `from` (a donde el usuario quería ir, o '/')
//   needsOrgSelection → `from` (el OrganizationSelector se monta en la ruta)
//   needsSetup        → '/register' (crear organización)
export function useAuthRedirect(from = '/') {
  const navigate = useNavigate();
  const { isLoggedIn, needsOrgSelection, needsSetup } = useUser();

  useEffect(() => {
    if (isLoggedIn) navigate(from, { replace: true });
    else if (needsOrgSelection) navigate(from, { replace: true });
    else if (needsSetup) navigate('/register', { replace: true });
  }, [isLoggedIn, needsOrgSelection, needsSetup, navigate, from]);
}
