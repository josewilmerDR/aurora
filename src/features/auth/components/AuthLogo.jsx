export default function AuthLogo() {
  return (
    <div className="auth-logo">
      <img src="/aurora-logo.png" alt="Aurora" className="auth-logo-img" />
      {/* La marca ya la anuncia el alt de la img; el label es refuerzo visual,
          así que lo ocultamos al lector de pantalla para no leer "Aurora" dos veces. */}
      <span className="auth-logo-label" aria-hidden="true">Aurora</span>
    </div>
  );
}
