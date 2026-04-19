// Financing domain guards. Pure — the config is passed in.
//
// Two guarantees this module enforces:
//
//   1. Kill switch per domain (`dominios.financing.activo`) — mirrors the
//      pattern used by financiera / procurement / external_signals.
//
//   2. Hard-coded Nivel 1 policy: financing NEVER escalates to nivel2 or
//      nivel3. Contracting debt is irreversible on a multi-year horizon, so
//      5.3/5.4/5.5 emit recommendations only. If some future code path ever
//      forgets and passes a higher level, `resolveFinancingLevel` clamps it
//      back to nivel1. The matching unit tests assert this invariant.
//
// When 5.5 ships the policy doc + dashboard, it will reuse this helper to
// block any attempt to register an autonomous action under this domain.

const FINANCING_MAX_LEVEL = 'nivel1';

// Returns true when the financing domain is enabled. Default: active.
function isFinancingDomainActive(autopilotConfig) {
  const d = autopilotConfig?.dominios?.financing;
  if (!d) return true;
  return d.activo !== false;
}

// Always nivel1 by design. We accept the config + global mode for signature
// symmetry with other domain resolvers, but the return value is fixed.
// eslint-disable-next-line no-unused-vars
function resolveFinancingLevel(autopilotConfig, globalMode) {
  return FINANCING_MAX_LEVEL;
}

// Helper that callers use in Express handlers: returns an ApiError-compatible
// object when the domain is paused, or null when free to proceed.
function assertFinancingActive(autopilotConfig) {
  if (!isFinancingDomainActive(autopilotConfig)) {
    return {
      blocked: true,
      reason: 'Financing domain is disabled (dominios.financing.activo = false).',
    };
  }
  return { blocked: false };
}

module.exports = {
  FINANCING_MAX_LEVEL,
  isFinancingDomainActive,
  resolveFinancingLevel,
  assertFinancingActive,
};
