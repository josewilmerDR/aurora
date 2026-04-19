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

// Hard-coded Nivel 1 policy — Fase 5.5.
//
// Contracting debt is irreversible on a multi-year horizon. Even if a caller
// (a route, a future agent, a stray action registration) tries to escalate
// the financing domain to nivel2 / nivel3, this guard blocks it. Together
// with the absence of any autopilot_actions in this domain, the blast radius
// of a bug or a misconfiguration stays bounded.
//
// Returns { blocked: true, reason } for anything but 'nivel1'.
// 'off' is treated as blocked too — N1 is the minimum for this domain.
function assertNivelAllowed(level) {
  if (level === FINANCING_MAX_LEVEL) {
    return { blocked: false };
  }
  return {
    blocked: true,
    reason: `Financing domain is Nivel 1 only by policy; requested level "${level}" is not permitted. See docs/financing-autonomy.md.`,
  };
}

// Names of autopilot actions that would indicate an escalation beyond N1.
// The invariant test in tests/unit/financing.actionsInvariant.test.js scans
// the action registry and fails if any of these names appears. Keeping the
// list here (not in a test file) means the invariant travels with the guard
// and any future contributor who adds one of these has to also remove it
// from this list — a deliberate friction point.
const FORBIDDEN_ACTION_TYPES = Object.freeze([
  'aplicar_credito',
  'solicitar_credito',
  'tomar_prestamo',
  'contratar_deuda',
  'aceptar_oferta_credito',
  'firmar_pagare',
]);

module.exports = {
  FINANCING_MAX_LEVEL,
  FORBIDDEN_ACTION_TYPES,
  isFinancingDomainActive,
  resolveFinancingLevel,
  assertFinancingActive,
  assertNivelAllowed,
};
