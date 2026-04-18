// Procurement domain guards. Pure — config is passed in, no Firestore here.
//
// Mirror of finance/financeDomainGuards.js but scoped to the procurement
// domain under autopilot_config.guardrails.dominios.procurement.

const VALID_LEVELS = new Set(['nivel1', 'nivel2', 'nivel3']);

// True when the procurement domain is enabled. Default: active.
function isProcurementDomainActive(autopilotConfig) {
  const d = autopilotConfig?.dominios?.procurement;
  if (!d) return true;
  return d.activo !== false;
}

// Resolves the effective autonomy level for the domain. If the domain has
// its own nivel, that wins; otherwise we fall back to the global mode.
//
//   nivel1 → recommendation only (no execution)
//   nivel2 → proposal escalated, awaits approval
//   nivel3 → executes automatically (subject to global guardrails)
function resolveProcurementLevel(autopilotConfig, globalMode) {
  const domainNivel = autopilotConfig?.dominios?.procurement?.nivel;
  if (typeof domainNivel === 'string' && VALID_LEVELS.has(domainNivel)) {
    return domainNivel;
  }
  return globalMode || 'off';
}

module.exports = {
  isProcurementDomainActive,
  resolveProcurementLevel,
};
