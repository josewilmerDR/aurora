import { useUser } from '../../../contexts/UserContext';
import { ROLE_LABELS } from '../../../contexts/UserContext';
import '../styles/login.css';

export default function FincaSelector() {
  const { memberships, selectFinca } = useUser();

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-logo-text">AU</span>
          <span className="login-logo-label">Aurora</span>
        </div>

        <h2 className="login-title">Selecciona una organización</h2>
        <p className="login-subtitle">Tienes acceso a más de una cuenta</p>

        <div className="finca-list">
          {memberships.map((m) => (
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
      </div>
    </div>
  );
}
