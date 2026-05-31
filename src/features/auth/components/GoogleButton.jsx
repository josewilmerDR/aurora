import GoogleIcon from '../../../components/ui/GoogleIcon';

export default function GoogleButton({ onClick, disabled, loading = false, label = 'Continuar con Google' }) {
  return (
    <button
      type="button"
      className="auth-btn-google"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      <GoogleIcon />
      {label}
    </button>
  );
}
