// Meta domain guards — Fase 6.1. Pure, config passed in.
//
// Mirrors the pattern used by procurement / finance / hr / financing guards:
// a kill switch per domain plus a level resolver. The meta domain does NOT
// hard-cap levels the way HR and financing do — the orchestrator at N2/N3
// fans out to specialist analyzers, and each of those still enforces its
// own domain cap inside its own analyzer. Defense-in-depth stays intact.

const VALID_LEVELS = new Set(['off', 'nivel1', 'nivel2', 'nivel3']);

// True when the meta domain is enabled. Default: active.
function isMetaDomainActive(autopilotConfig) {
  const d = autopilotConfig?.dominios?.meta;
  if (!d) return true;
  return d.activo !== false;
}

// Resolves the effective autonomy level for the meta domain. Domain-level
// config wins over the global mode, same as other domains.
//
//   off     → orchestrator short-circuits, emits nothing.
//   nivel1  → plan is emitted as a recommendation, no fan-out.
//   nivel2  → plan is emitted AND orchestrator dispatches analyzer fan-out.
//   nivel3  → same as nivel2 at the orchestrator layer; N3 semantics for
//             cross-domain chains belong to Fase 6.4, not here.
function resolveMetaLevel(autopilotConfig, globalMode) {
  const domainNivel = autopilotConfig?.dominios?.meta?.nivel;
  if (typeof domainNivel === 'string' && VALID_LEVELS.has(domainNivel)) {
    return domainNivel;
  }
  return globalMode && VALID_LEVELS.has(globalMode) ? globalMode : 'off';
}

// Helper for route handlers. Returns a blocked reason when inactive, or
// `{ blocked: false }` when free to proceed. Mirrors `assertFinancingActive`.
function assertMetaActive(autopilotConfig) {
  if (!isMetaDomainActive(autopilotConfig)) {
    return {
      blocked: true,
      reason: 'Meta domain is disabled (dominios.meta.activo = false).',
    };
  }
  return { blocked: false };
}

module.exports = {
  isMetaDomainActive,
  resolveMetaLevel,
  assertMetaActive,
  VALID_LEVELS,
};
