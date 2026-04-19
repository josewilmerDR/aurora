// Small shim that re-exports `HR_ACTION_TYPES` from the canonical HR
// location so `chainValidator.js` can depend on it without pulling the
// full HR action caps module (which would introduce a circular import
// through autopilotGuardrails).
//
// Centralising the list under `meta/chains/` also makes it obvious that
// this sub-fase treats HR actions as a first-class forbidden category
// at the chain boundary, independent of the per-action dispatch defense.

const { HR_ACTION_TYPES } = require('../../hr/hrActionCaps');

module.exports = { HR_ACTION_TYPES };
