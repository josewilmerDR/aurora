export default function AuthLoading({ text = 'Verificando cuenta...' }) {
  return (
    <div className="auth-loading">
      <div className="auth-spinner" />
      <p className="auth-loading-text">{text}</p>
    </div>
  );
}
