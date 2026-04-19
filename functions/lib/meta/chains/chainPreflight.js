// Chain preflight — Fase 6.4. I/O.
//
// Runs the existing `validateGuardrails` (from Fase 1.4 + extended
// through Fases 2/3/5) against every step of a chain BEFORE the
// executor touches Firestore. If any step would be blocked at
// execution, we surface it now so the caller can either abandon the
// chain or adjust parameters before committing.
//
// Preflight is advisory, not final: guardrails that depend on runtime
// state (e.g., cash floor, daily counters) may drift between preflight
// and execution. The executor still re-validates and catches that case.

const { db } = require('../../firebase');
const { validateGuardrails } = require('../../autopilotGuardrails');
const { isPaused: isAutopilotPaused } = require('../../autopilotKillSwitch');

async function preflightChain(chain, fincaId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();

  // Global kill switch — if paused, nothing will execute anyway.
  if (await isAutopilotPaused(fincaId)) {
    return {
      ok: false,
      ranAt: now.toISOString(),
      reason: 'Autopilot is paused.',
      perStep: [],
      blockedStepIds: [],
    };
  }

  // Config snapshot for guardrail defaults.
  const configSnap = await db.collection('autopilot_config').doc(fincaId).get();
  const config = configSnap.exists ? configSnap.data() : {};
  const guardrails = config.guardrails || {};

  // We check each step INDEPENDENTLY against the guardrails at T0. This
  // means two steps that each consume half the daily budget both pass —
  // the executor enforces cumulative limits per-step at run time, when
  // the daily counters are actually available.
  const perStep = [];
  const blockedStepIds = [];
  const steps = Array.isArray(chain?.steps) ? chain.steps : [];

  for (const step of steps) {
    try {
      const result = await validateGuardrails(
        step.actionType,
        step.params || {},
        guardrails,
        { fincaId, sessionExecutedCount: 0, now },
      );
      const entry = {
        stepId: step.id,
        actionType: step.actionType,
        ok: !!result.allowed,
        violations: result.allowed ? [] : result.violations || [],
      };
      if (!entry.ok) blockedStepIds.push(step.id);
      perStep.push(entry);
    } catch (err) {
      perStep.push({
        stepId: step.id,
        actionType: step.actionType,
        ok: false,
        violations: [err?.message || String(err)],
      });
      blockedStepIds.push(step.id);
    }
  }

  const ok = blockedStepIds.length === 0;
  return {
    ok,
    ranAt: now.toISOString(),
    perStep,
    blockedStepIds,
    blockedReason: ok
      ? null
      : `Chain preflight blocked: ${blockedStepIds.length} of ${steps.length} steps violate guardrails.`,
  };
}

module.exports = { preflightChain };
