import AuthLogo from './AuthLogo';

export default function AuthCard({ variant, title, subtitle, footer, children }) {
  const cardClass = `auth-card${variant === 'wide' ? ' auth-card--wide' : ''}`;
  return (
    <div className="auth-page">
      <div className={cardClass}>
        <AuthLogo />
        {title && <h2 className="auth-title">{title}</h2>}
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
        {footer}
      </div>
    </div>
  );
}
