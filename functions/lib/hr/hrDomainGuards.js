// HR (RRHH) domain guards. Pure — config is passed in, no Firestore here.
//
// Mirror of procurement/procurementDomainGuards.js but with a hard cap:
// the HR domain can NEVER resolve to 'nivel3'. Decisions that affect
// people (hiring/firing/discipline) must always keep a human in the loop.
// If anyone — config writer, caller, or tampered payload — tries to set
// the HR domain to nivel3, resolveHrLevel clamps it to 'nivel2'.

const VALID_LEVELS = new Set(['nivel1', 'nivel2', 'nivel3']);
const MAX_ALLOWED_LEVEL = 'nivel2';

// True when the RRHH domain is enabled. Default: active.
function isHrDomainActive(autopilotConfig) {
  const d = autopilotConfig?.dominios?.rrhh;
  if (!d) return true;
  return d.activo !== false;
}

// Resolves the effective autonomy level for the HR domain, with a hard
// clamp at `nivel2`. Order:
//   1. If the domain has an explicit `nivel`, use it (clamped).
//   2. Otherwise fall back to the global mode (also clamped).
//   3. 'off' stays 'off' (nothing runs).
//
// The clamp applies regardless of what the caller passes in, which is
// why this is the canonical level resolver for HR.
function resolveHrLevel(autopilotConfig, globalMode) {
  const domainNivel = autopilotConfig?.dominios?.rrhh?.nivel;
  if (typeof domainNivel === 'string' && VALID_LEVELS.has(domainNivel)) {
    return clampLevel(domainNivel);
  }
  return clampLevel(globalMode || 'off');
}

function clampLevel(level) {
  if (level === 'nivel3') return MAX_ALLOWED_LEVEL;
  return level;
}

module.exports = {
  isHrDomainActive,
  resolveHrLevel,
  MAX_ALLOWED_LEVEL,
};
