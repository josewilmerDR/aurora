// Per-candidate routing: decides whether to persist as a plain recommendation
// (nivel1/off), escalate for approval (nivel2 or guardrail violation), or
// execute inline (nivel3 + all guardrails pass).
//
// Returns a result row suitable for the analyze response plus the mutated
// session counter for the next iteration.

const { db, Timestamp } = require('../../lib/firebase');
const { validateGuardrails } = require('../../lib/autopilotGuardrails');
const { executeAutopilotAction } = require('../../lib/autopilotActions');

async function routeCandidate({
  candidate,
  level,
  fincaId,
  sessionId,
  guardrails,
  sessionExecutedCount,
  proposedBy,
  proposedByName,
}) {
  const actionDocRef = db.collection('autopilot_actions').doc();
  const baseDoc = {
    fincaId,
    sessionId,
    type: candidate.type,
    params: candidate.params,
    titulo: candidate.titulo,
    descripcion: candidate.descripcion,
    prioridad: candidate.prioridad,
    categoria: 'procurement',
    autonomous: level === 'nivel3',
    escalated: false,
    guardrailViolations: null,
    proposedBy: proposedBy || null,
    proposedByName: proposedByName || 'autopilot',
    createdAt: Timestamp.now(),
    reviewedBy: null,
    reviewedByName: null,
    reviewedAt: null,
    rejectionReason: null,
    // Traceability — link back to the gap so the UI can show context.
    procurementGap: candidate.gap ? {
      productoId: candidate.gap.productoId,
      nombreComercial: candidate.gap.nombreComercial,
      urgency: candidate.gap.urgency,
      suggestedQty: candidate.gap.suggestedQty,
    } : null,
    procurementSupplier: candidate.supplier || null,
    estimatedAmount: candidate.estimatedAmount ?? null,
  };

  if (level === 'nivel1' || level === 'off') {
    await actionDocRef.set({ ...baseDoc, status: 'proposed', escalated: true });
    return {
      actionId: actionDocRef.id,
      status: 'proposed',
      type: candidate.type,
      level,
      gap: baseDoc.procurementGap,
    };
  }

  const guardResult = await validateGuardrails(
    candidate.type, candidate.params, guardrails,
    { fincaId, sessionExecutedCount }
  );

  if (level === 'nivel2' || !guardResult.allowed) {
    await actionDocRef.set({
      ...baseDoc,
      status: 'proposed',
      escalated: true,
      guardrailViolations: guardResult.allowed ? null : guardResult.violations,
    });
    return {
      actionId: actionDocRef.id,
      status: 'proposed',
      escalated: true,
      type: candidate.type,
      reason: guardResult.allowed ? 'nivel2' : 'guardrails',
      violations: guardResult.allowed ? null : guardResult.violations,
      gap: baseDoc.procurementGap,
    };
  }

  try {
    const execResult = await executeAutopilotAction(
      candidate.type, candidate.params, fincaId,
      { actionDocRef, actionInitialDoc: baseDoc, level }
    );
    return {
      actionId: actionDocRef.id,
      status: 'executed',
      type: candidate.type,
      result: execResult,
      gap: baseDoc.procurementGap,
    };
  } catch (execErr) {
    return {
      actionId: actionDocRef.id,
      status: 'failed',
      type: candidate.type,
      error: execErr.message,
      gap: baseDoc.procurementGap,
    };
  }
}

module.exports = { routeCandidate };
