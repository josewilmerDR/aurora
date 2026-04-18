// HR (RRHH) action caps — the unique piece of Phase 3 infrastructure.
//
// Finance and procurement domains trust the user to pick a level. HR does
// not, because decisions about people are low-reversibility and carry
// legal and ethical weight.
//
// FORBIDDEN_AT_NIVEL3 lists actions that must never execute autonomously,
// even if every other guardrail passes. `capHrActionLevel` is the
// enforcement primitive used by the guardrails layer and the dispatcher.

// Action types belonging to the HR domain. Guardrails use this to route
// violations into the `hr` category and to gate the kill switch.
const HR_ACTION_TYPES = Object.freeze([
  'sugerir_contratacion',
  'sugerir_despido',
  'sugerir_sancion',
  'sugerir_memorando',
  'sugerir_revision_desempeno',
]);

// Actions that must never run at 'nivel3' regardless of config. The cap
// reduces them to at most 'nivel2' (escalated proposal, awaits a human).
//
// `sugerir_despido`, `sugerir_sancion`, `sugerir_memorando` also appear
// here, but their policy cap in the config UI is even stricter (nivel1
// only). FORBIDDEN_AT_NIVEL3 is the floor for the runtime guard; the UI
// and PUT validator enforce the stricter ceiling.
const FORBIDDEN_AT_NIVEL3 = new Set([
  'sugerir_contratacion',
  'sugerir_despido',
  'sugerir_sancion',
  'sugerir_memorando',
  'sugerir_revision_desempeno',
]);

// Returns the level at which a given HR action is allowed to run.
// For actions NOT in FORBIDDEN_AT_NIVEL3, the requested level passes
// through. For forbidden actions, 'nivel3' is clamped to 'nivel2'.
// Unknown action types pass through unchanged (caller decides).
function capHrActionLevel(actionType, requestedLevel) {
  if (!FORBIDDEN_AT_NIVEL3.has(actionType)) return requestedLevel;
  if (requestedLevel === 'nivel3') return 'nivel2';
  return requestedLevel;
}

// Convenience predicate for the guardrails layer.
function isHrActionType(actionType) {
  return HR_ACTION_TYPES.includes(actionType);
}

module.exports = {
  HR_ACTION_TYPES,
  FORBIDDEN_AT_NIVEL3,
  capHrActionLevel,
  isHrActionType,
};
