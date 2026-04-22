import { useState, useEffect } from 'react';
import { useUser, ROLE_LABELS } from '../../../contexts/UserContext';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../lib/apiFetch';
import '../styles/login.css';

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
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">
            <img src="/aurora-logo.png" alt="Aurora" className="login-logo-img" />
            <span className="login-logo-label">Aurora</span>
          </div>
          <div className="login-google-loading">
            <div className="login-google-spinner" />
            <p className="login-google-loading-text">Verificando cuenta...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card org-selector-card">
        <div className="login-logo">
          <img src="/aurora-logo.png" alt="Aurora" className="login-logo-img" />
          <span className="login-logo-label">Aurora</span>
        </div>

        <h2 className="login-title">Tus organizaciones</h2>
        {firebaseUser?.email && (
          <p className="login-subtitle">{firebaseUser.email}</p>
        )}

        {noMemberships ? (
          <>
            <p className="org-empty-message">
              En este momento no perteneces a ninguna organización.
              Crea tu primera organización e invita a otras personas a unirse a ella.
            </p>
            <button className="login-btn org-selector-cta" onClick={() => navigate('/nueva-organizacion')}>
              + Crear organización
            </button>
          </>
        ) : (
          <>
            {hasOwnOrg && (
              <div className="org-section">
                <span className="org-section-title">Tu organización</span>
                {ownedOrgs.map(m => (
                  <button
                    key={m.fincaId}
                    className="finca-item finca-item-own"
                    onClick={() => selectFinca(m.fincaId)}
                  >
                    <span className="finca-item-nombre">Ir a {m.fincaNombre}</span>
                    <span className="finca-item-owner-badge">Tuya</span>
                  </button>
                ))}
              </div>
            )}

            {!hasOwnOrg && (
              <button className="login-btn org-selector-cta" onClick={() => navigate('/nueva-organizacion')}>
                + Crear organización
              </button>
            )}

            {invitedOrgs.length > 0 && (
              <div className="org-section">
                <span className="org-section-title">Otras organizaciones</span>
                {invitedOrgs.map(m => (
                  <button
                    key={m.fincaId}
                    className="finca-item"
                    onClick={() => selectFinca(m.fincaId)}
                  >
                    <span className="finca-item-nombre">{m.fincaNombre}</span>
                    <span className="finca-item-rol">{ROLE_LABELS[m.rol] || m.rol}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <button className="login-register-link-btn" onClick={logout}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
