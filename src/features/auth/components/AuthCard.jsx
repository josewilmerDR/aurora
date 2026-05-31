import AuthLogo from './AuthLogo';

export default function AuthCard({ variant, title, subtitle, footer, children }) {
  const cardClass = `auth-card${variant === 'wide' ? ' auth-card--wide' : ''}`;
  return (
    // <main> da un landmark al que saltar con lector de pantalla; cada página de
    // auth es una ruta separada, así que un solo <h1> por pantalla es correcto.
    <main className="auth-page">
      <div className={cardClass}>
        <AuthLogo />
        {title && <h1 className="auth-title">{title}</h1>}
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
        {footer}
      </div>
    </main>
  );
}
