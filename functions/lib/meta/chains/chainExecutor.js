// Chain executor — Fase 6.4. I/O. Handles the sequential run of a
// chain plus the rollback cascade when any step fails.
//
// Flow:
//
//   1. Load chain doc, guard against states that forbid execution
//      (already running / completed / expired).
//   2. Topologically sort steps once (the validator already checked for
//      cycles, we just need the final order).
//   3. For each step in order:
//        a. mark execution.perStep[i] as 'running'
//        b. call executeAutopilotAction(actionType, params, fincaId, {
//             actionDocRef, actionInitialDoc
//           })
//        c. on success: store actionId + move on
//        d. on failure: stop, trigger rollback cascade
//   4. Rollback cascade: for every step that was 'executed' in reverse
//      order, call applyRollback(actionId). Record the outcome.
//   5. Update chain.status and close.
//
// The function is defensive against partial failures: if rollback
// itself partially fails, the chain is marked `rolled_back_partial`
// and the per-step rollback outcomes show which steps still need
// manual attention.

const { db, Timestamp, FieldValue } = require('../../firebase');
const { executeAutopilotAction } = require('../../autopilotActions');
const { applyRollback } = require('../../autopilotCompensations');
const { topologicalSort } = require('./chainValidator');

const CHAIN_COLLECTION = 'meta_chains';
const AUTOPILOT_ACTIONS = 'autopilot_actions';

const EXECUTABLE_STATUSES = new Set([
  'planned',
  'preflight_ok',
]);

function nowTs() { return Timestamp.now(); }
function nowIso() { return new Date().toISOString(); }

function isExpired(chain, now = new Date()) {
  const exp = chain.expiresAt;
  if (!exp) return false;
  const ms = typeof exp.toMillis === 'function' ? exp.toMillis() : null;
  return ms != null && ms < now.getTime();
}

async function loadChain(chainId, fincaId) {
  const ref = db.collection(CHAIN_COLLECTION).doc(chainId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, code: 'NOT_FOUND' };
  const data = snap.data();
  if (data.fincaId !== fincaId) return { ok: false, code: 'FORBIDDEN' };
  return { ok: true, ref, data };
}

// Runs one step: writes the action doc, calls the dispatcher, captures
// the outcome. Returns `{ ok, actionId, error? }`.
async function runOneStep({ step, chain, fincaId, actor, chainSessionId }) {
  const actionDocRef = db.collection(AUTOPILOT_ACTIONS).doc();
  const baseDoc = {
    fincaId,
    sessionId: chainSessionId,
    chainId: chain.id,
    chainStepId: step.id,
    type: step.actionType,
    params: step.params || {},
    titulo: `Chain step ${step.id}: ${step.actionType}`,
    descripcion: step.rationale || `Ejecutado como parte de la cadena ${chain.id}.`,
    prioridad: 'media',
    categoria: 'meta',
    autonomous: true,
    escalated: false,
    guardrailViolations: null,
    proposedBy: actor?.uid || null,
    proposedByName: actor?.email || 'chain-executor',
    createdAt: nowTs(),
    reviewedBy: null,
    reviewedByName: null,
    reviewedAt: null,
    rejectionReason: null,
  };
  try {
    const result = await executeAutopilotAction(
      step.actionType,
      step.params || {},
      fincaId,
      { actionDocRef, actionInitialDoc: baseDoc },
    );
    return { ok: true, actionId: actionDocRef.id, result };
  } catch (err) {
    return { ok: false, actionId: actionDocRef.id, error: err?.message || String(err) };
  }
}

// Runs the rollback cascade for all steps that were `executed`, newest
// first. Records the per-step rollback outcome inside the chain doc.
async function cascadeRollback({ executedSteps, fincaId, actor }) {
  const perStepOutcome = [];
  let allOk = true;
  for (let i = executedSteps.length - 1; i >= 0; i--) {
    const step = executedSteps[i];
    const result = await applyRollback(step.actionId, fincaId, {
      uid: actor?.uid || null,
      email: actor?.email || 'chain-executor',
    });
    if (!result.ok) allOk = false;
    perStepOutcome.push({
      stepId: step.stepId,
      actionId: step.actionId,
      status: result.ok ? 'rolled_back' : 'rollback_failed',
      code: result.ok ? null : result.code,
      error: result.ok ? null : result.message || null,
      rolledBackAt: nowIso(),
    });
  }
  // Reverse so the saved list is in original step order for display.
  perStepOutcome.reverse();
  return { allOk, perStepOutcome };
}

// ── Main entry point ──────────────────────────────────────────────────────

async function executeChain(chainId, fincaId, actor) {
  const loaded = await loadChain(chainId, fincaId);
  if (!loaded.ok) return { ok: false, code: loaded.code };
  const { ref: chainRef, data: chain } = loaded;

  // Gatekeeping
  if (!EXECUTABLE_STATUSES.has(chain.status)) {
    return {
      ok: false,
      code: 'CONFLICT',
      message: `Chain is in status "${chain.status}"; only planned/preflight_ok chains can be executed.`,
    };
  }
  if (isExpired(chain)) {
    await chainRef.update({ status: 'expired', updatedAt: nowTs() });
    return { ok: false, code: 'EXPIRED' };
  }

  // Topological order. validator ran at creation so this shouldn't fail,
  // but we double-check defensively.
  const topo = topologicalSort(chain.plan?.steps || []);
  if (!topo.ok) {
    return { ok: false, code: 'INVALID', message: topo.reason };
  }
  const stepById = new Map((chain.plan?.steps || []).map(s => [s.id, s]));
  const orderedSteps = topo.order.map(id => stepById.get(id)).filter(Boolean);

  const chainSessionId = `chain-${chainId}`;
  const perStepExecution = orderedSteps.map(s => ({
    stepId: s.id,
    actionType: s.actionType,
    status: 'pending',
    actionId: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  }));

  // Mark chain as executing up front so concurrent calls fail fast.
  await chainRef.update({
    status: 'executing',
    execution: {
      status: 'running',
      startedAt: nowTs(),
      finishedAt: null,
      perStep: perStepExecution,
      rollback: null,
      chainSessionId,
    },
    updatedAt: nowTs(),
  });

  // Execute step-by-step.
  const executed = []; // { stepId, actionId } only for successes
  let failedAt = null;
  let failedReason = null;

  for (let i = 0; i < orderedSteps.length; i++) {
    const step = orderedSteps[i];
    perStepExecution[i].status = 'running';
    perStepExecution[i].startedAt = nowIso();
    await chainRef.update({
      'execution.perStep': perStepExecution,
      updatedAt: nowTs(),
    });

    const result = await runOneStep({
      step,
      chain: { ...chain, id: chainId },
      fincaId,
      actor,
      chainSessionId,
    });

    perStepExecution[i].finishedAt = nowIso();
    perStepExecution[i].actionId = result.actionId;

    if (result.ok) {
      perStepExecution[i].status = 'executed';
      executed.push({ stepId: step.id, actionId: result.actionId });
      await chainRef.update({
        'execution.perStep': perStepExecution,
        updatedAt: nowTs(),
      });
    } else {
      perStepExecution[i].status = 'failed';
      perStepExecution[i].error = result.error;
      failedAt = i;
      failedReason = result.error;
      // Mark remaining steps as skipped so the UI is clear.
      for (let j = i + 1; j < orderedSteps.length; j++) {
        perStepExecution[j].status = 'skipped';
      }
      await chainRef.update({
        'execution.perStep': perStepExecution,
        updatedAt: nowTs(),
      });
      break;
    }
  }

  // All steps executed successfully → mark completed.
  if (failedAt === null) {
    await chainRef.update({
      status: 'completed',
      'execution.status': 'completed',
      'execution.finishedAt': nowTs(),
      updatedAt: nowTs(),
    });
    return { ok: true, status: 'completed', executedSteps: executed.length };
  }

  // Otherwise: cascade rollback.
  const rollback = await cascadeRollback({ executedSteps: executed, fincaId, actor });
  const finalStatus = rollback.allOk ? 'rolled_back' : 'rolled_back_partial';
  await chainRef.update({
    status: finalStatus,
    'execution.status': 'failed',
    'execution.finishedAt': nowTs(),
    'execution.rollback': {
      applied: true,
      fullyApplied: rollback.allOk,
      appliedAt: nowTs(),
      perStepOutcome: rollback.perStepOutcome,
      triggeredByStepId: orderedSteps[failedAt]?.id || null,
      triggeredByReason: failedReason,
    },
    updatedAt: nowTs(),
  });

  return {
    ok: false,
    code: 'CHAIN_FAILED',
    status: finalStatus,
    failedStepId: orderedSteps[failedAt]?.id || null,
    failedReason,
    rollback,
  };
}

// ── Abort ─────────────────────────────────────────────────────────────────

async function abortChain(chainId, fincaId, actor, { reason = '' } = {}) {
  const loaded = await loadChain(chainId, fincaId);
  if (!loaded.ok) return { ok: false, code: loaded.code };
  const { ref: chainRef, data: chain } = loaded;

  // If not yet started, just mark aborted — nothing to undo.
  if (chain.status === 'planned' || chain.status === 'preflight_ok') {
    await chainRef.update({
      status: 'aborted',
      abortedAt: nowTs(),
      abortedBy: actor?.uid || null,
      abortedByEmail: actor?.email || '',
      abortedReason: String(reason).slice(0, 512),
      updatedAt: nowTs(),
    });
    return { ok: true, status: 'aborted' };
  }

  // If it already finished, can't abort.
  if (['completed', 'rolled_back', 'rolled_back_partial', 'aborted', 'expired'].includes(chain.status)) {
    return { ok: false, code: 'CONFLICT', message: `Chain is already in terminal state "${chain.status}".` };
  }

  // If running: trigger rollback of completed steps. This is best-effort.
  const exec = chain.execution || {};
  const perStep = Array.isArray(exec.perStep) ? exec.perStep : [];
  const executed = perStep.filter(s => s.status === 'executed' && s.actionId);
  const rollback = await cascadeRollback({
    executedSteps: executed.map(s => ({ stepId: s.stepId, actionId: s.actionId })),
    fincaId,
    actor,
  });
  await chainRef.update({
    status: rollback.allOk ? 'aborted' : 'rolled_back_partial',
    'execution.status': 'aborted',
    'execution.finishedAt': nowTs(),
    'execution.rollback': {
      applied: true,
      fullyApplied: rollback.allOk,
      appliedAt: nowTs(),
      perStepOutcome: rollback.perStepOutcome,
      triggeredByStepId: null,
      triggeredByReason: `abort: ${String(reason).slice(0, 256)}`,
    },
    abortedAt: nowTs(),
    abortedBy: actor?.uid || null,
    abortedByEmail: actor?.email || '',
    abortedReason: String(reason).slice(0, 512),
    updatedAt: nowTs(),
  });
  return { ok: true, status: rollback.allOk ? 'aborted' : 'rolled_back_partial', rollback };
}

module.exports = {
  executeChain,
  abortChain,
  // Exposed for tests / other modules
  loadChain,
  isExpired,
  cascadeRollback,
  runOneStep,
  CHAIN_COLLECTION,
};
