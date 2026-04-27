import { useState, useEffect } from 'react';
import { useUser, ROLE_LABELS } from '../../../contexts/UserContext';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../lib/apiFetch';
import AuthCard from '../components/AuthCard';
import AuthLoading from '../components/AuthLoading';
import '../styles/auth.css';

export default function OrganizationSelector() {
  const { memberships, selectFinca, firebaseUser, logout, refreshMemberships } = useUser();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  // Fallback: si al montar no hay membresías, intentar reclamar invitaciones pendientes.
  // Cubre el caso en que onAuthStateChanged no pudo completar la verificación a tiempo.
  useEffect(() => {
    if (memberships.length > 0) return;
    setChecking(true);
    apiFetch('/api/auth/claim-invitations', { method: 'POST' })
      .then(res => res.ok ? res.json() : { memberships: [] })
      .then(async (data) => {
        if (data.memberships?.length > 0) {
          await refreshMemberships();
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ownedOrgs = memberships.filter(m => m.isOwner);
  const invitedOrgs = memberships.filter(m => !m.isOwner);
  const hasOwnOrg = ownedOrgs.length > 0;
  const noMemberships = memberships.length === 0;

  if (checking) {
    return (
      <AuthCard>
        <AuthLoading />
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
      {noMemberships ? (
        <>
          <p className="auth-org-empty">
            En este momento no perteneces a ninguna organización.
            Crea tu primera organización e invita a otras personas a unirse a ella.
          </p>
          <button
            className="aur-btn-pill auth-btn-submit"
            onClick={() => navigate('/nueva-organizacion')}
          >
            + Crear organización
          </button>
        </>
      ) : (
        <>
          {hasOwnOrg && (
            <div className="auth-org-section">
              <span className="auth-org-section-title">Tu organización</span>
              {ownedOrgs.map(m => (
                <button
                  key={m.fincaId}
                  className="auth-org-item auth-org-item--own"
                  onClick={() => selectFinca(m.fincaId)}
                >
                  <span className="auth-org-item-name">Ir a {m.fincaNombre}</span>
                  <span className="aur-badge aur-badge--green">Tuya</span>
                </button>
              ))}
            </div>
          )}

          {!hasOwnOrg && (
            <button
              className="aur-btn-pill auth-btn-submit"
              onClick={() => navigate('/nueva-organizacion')}
            >
              + Crear organización
            </button>
          )}

          {invitedOrgs.length > 0 && (
            <div className="auth-org-section">
              <span className="auth-org-section-title">Otras organizaciones</span>
              {invitedOrgs.map(m => (
                <button
                  key={m.fincaId}
                  className="auth-org-item"
                  onClick={() => selectFinca(m.fincaId)}
                >
                  <span className="auth-org-item-name">{m.fincaNombre}</span>
                  <span className="auth-org-item-rol">{ROLE_LABELS[m.rol] || m.rol}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </AuthCard>
  );
}
