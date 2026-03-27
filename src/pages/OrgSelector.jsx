import { useUser, ROLE_LABELS } from '../contexts/UserContext';
import { useNavigate } from 'react-router-dom';
import './Login.css';

export default function OrgSelector() {
  const { memberships, selectFinca, firebaseUser, logout } = useUser();
  const navigate = useNavigate();

  const ownedOrgs = memberships.filter(m => m.isOwner);
  const invitedOrgs = memberships.filter(m => !m.isOwner);
  const hasOwnOrg = ownedOrgs.length > 0;
  const noMemberships = memberships.length === 0;

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
