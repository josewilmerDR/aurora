// Build-time feature flag mirror of src/lib/features.js for the backend.
//
// When isAdvanced() returns false (default), routers and crons that power the
// advanced surface (Estrategia, Financiamiento, Meta-agencia, Orchestrator)
// are not mounted/exported. Flip via FEATURES_ADVANCED=true in functions/.env.
function isAdvanced() {
  return process.env.FEATURES_ADVANCED === 'true';
}

module.exports = { isAdvanced };
