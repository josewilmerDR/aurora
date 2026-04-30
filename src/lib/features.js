// Build-time feature flag for the v1 public release.
//
// When false (default), the "advanced" surface — Estrategia, Financiamiento
// externo, CEO dashboard, Autopilot/Copilot — is hidden from the UI and the
// matching backend routes are not mounted. Flip to true via
// VITE_FEATURES_ADVANCED=true to expose Fases 4–6.
export const ADVANCED_ENABLED =
  import.meta.env.VITE_FEATURES_ADVANCED === 'true';
