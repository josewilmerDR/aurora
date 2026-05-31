import { useState, useEffect, useRef, useCallback } from 'react';
import { useUser, ROLE_LABELS } from '../../../contexts/UserContext';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../lib/apiFetch';
import AuthCard from '../components/AuthCard';
import AuthLoading from '../components/AuthLoading';
import '../styles/auth.css';

export default function OrganizationSelector() {
  const { memberships, selectFinca, firebaseUser, logout, refreshMemberships, activeFincaId } = useUser();
  const navigate = useNavigate();
  // Si llegamos sin membresías arrancamos en "buscando" para que el primer
  // render no parpadee el empty-state antes de que el effect reclame invitaciones.
  const [checking, setChecking] = useState(memberships.length === 0);
  // null = no error; otherwise a user-facing (Spanish) message. We branch by
  // HTTP status so a 429/5xx isn't disguised as a connectivity problem.
  const [error, setError] = useState(null);
  const [enteringId, setEnteringId] = useState(null);
  const claimedRef = useRef(false);
  const mountedRef = useRef(true);

  // Reseteamos en el montaje (no solo en el desmontaje): bajo StrictMode en dev
  // el ciclo monta→desmonta→remonta deja mountedRef en false para siempre si
  // solo se setea en el cleanup, y entonces el `finally` de runClaim nunca
  // limpia `checking` → spinner "Buscando tus organizaciones…" infinito.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Red de seguridad: reclamar invitaciones pendientes si llegamos sin membresías.
  // El claim principal corre en onAuthStateChanged (UserContext); esto solo cubre
  // que aquel haya fallado por red. A diferencia de antes, un fallo de red ahora
  // se muestra como error en vez de disfrazarse de "no tenés organizaciones".
  const runClaim = useCallback(async () => {
    setError(null);
    setChecking(true);
    try {
      const res = await apiFetch('/api/auth/claim-invitations', { method: 'POST' });
      if (!res.ok) {
        // 401/403 = the token was rejected (session revoked, account disabled,
        // email no longer verified). Retrying the claim will keep failing, so
        // instead of offering a useless "Reintentar" we sign the user out;
        // onAuthStateChanged then sends them back to /login to re-authenticate.
        if (res.status === 401 || res.status === 403) {
          await logout();
          return;
        }
        // Reached the server but it refused: distinguish rate-limiting from a
        // generic server-side failure. Network failures throw and land in the
        // catch below with the connectivity message.
        if (mountedRef.current) {
          setError(res.status === 429
            ? 'Demasiadas solicitudes. Esperá un momento e intentá de nuevo.'
            : 'No pudimos cargar tus organizaciones. Intentá de nuevo en unos minutos.');
        }
        return;
      }
      const data = await res.json();
      if (data.memberships?.length > 0) await refreshMemberships();
    } catch {
      if (mountedRef.current) {
        setError('No pudimos cargar tus organizaciones. Revisá tu conexión e intentá de nuevo.');
      }
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, [refreshMemberships, logout]);

  // Liberar el bloqueo "Entrando…" si la selección no prospera. handleSelect fija
  // enteringId y selectFinca pone activeFincaId; si el perfil falla (membresía
  // revocada o finca borrada entre listar y entrar) UserContext limpia
  // activeFincaId y volvemos al selector. Sin esto los botones quedarían
  // deshabilitados a la espera de un remount que no está garantizado.
  useEffect(() => {
    if (!activeFincaId) setEnteringId(null);
  }, [activeFincaId]);

  useEffect(() => {
    if (memberships.length > 0 || claimedRef.current) return;
    claimedRef.current = true; // evita doble disparo (StrictMode / re-render)
    runClaim();
  }, [memberships.length, runClaim]);

  // Auto-seleccionar cuando hay una sola organización: nadie debería elegir de
  // una lista de un único elemento. Alinea el comportamiento con
  // refreshMemberships(), que ya auto-selecciona en ese caso.
  useEffect(() => {
    if (memberships.length === 1) selectFinca(memberships[0].fincaId);
  }, [memberships, selectFinca]);

  const ownedOrgs = memberships.filter(m => m.isOwner);
  const invitedOrgs = memberships.filter(m => !m.isOwner);
  const hasOwnOrg = ownedOrgs.length > 0;
  const noMemberships = memberships.length === 0;

  const handleSelect = (fincaId) => {
    if (enteringId) return; // bloquea doble click / selección concurrente
    setEnteringId(fincaId);
    selectFinca(fincaId);
  };

  const createOrgButton = (
    <button
      className="aur-btn-pill auth-btn-submit"
      onClick={() => navigate('/nueva-organizacion')}
    >
      + Crear organización
    </button>
  );

  if (checking) {
    return (
      <AuthCard>
        <AuthLoading text="Buscando tus organizaciones..." />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      variant="wide"
      title="Tus organizaciones"
      subtitle={firebaseUser?.email}
      footer={
        <button className="aur-btn-text" onClick={logout}>
          Cerrar sesión
        </button>
      }
    >
      <div className="auth-org-body" aria-live="polite">
        {error ? (
          <>
            <p className="auth-error" role="alert">
              {error}
            </p>
            <button className="aur-btn-pill auth-btn-submit" onClick={runClaim}>
              Reintentar
            </button>
          </>
        ) : noMemberships ? (
          <>
            <p className="auth-org-empty">
              En este momento no perteneces a ninguna organización.
              Crea tu primera organización e invita a otras personas a unirse a ella.
            </p>
            {createOrgButton}
          </>
        ) : (
          <>
            {hasOwnOrg && (
              <section className="auth-org-section">
                <h3 className="auth-org-section-title">Tu organización</h3>
                <ul className="auth-org-list" role="list">
                  {ownedOrgs.map(m => (
                    <li key={m.fincaId}>
                      <button
                        className="auth-org-item auth-org-item--own"
                        onClick={() => handleSelect(m.fincaId)}
                        disabled={!!enteringId}
                      >
                        <span className="auth-org-item-name">{m.fincaNombre}</span>
                        <span className="aur-badge aur-badge--green">
                          {enteringId === m.fincaId ? 'Entrando…' : 'Tuya'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!hasOwnOrg && createOrgButton}

            {invitedOrgs.length > 0 && (
              <section className="auth-org-section">
                <h3 className="auth-org-section-title">Otras organizaciones</h3>
                <ul className="auth-org-list" role="list">
                  {invitedOrgs.map(m => (
                    <li key={m.fincaId}>
                      <button
                        className="auth-org-item"
                        onClick={() => handleSelect(m.fincaId)}
                        disabled={!!enteringId}
                      >
                        <span className="auth-org-item-name">{m.fincaNombre}</span>
                        <span className="aur-badge aur-badge--gray">
                          {enteringId === m.fincaId ? 'Entrando…' : (ROLE_LABELS[m.rol] || 'Miembro')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </AuthCard>
  );
}
