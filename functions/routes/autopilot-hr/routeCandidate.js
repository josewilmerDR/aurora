// Per-candidate routing for HR recommendations.
//
// Unlike procurement/finance, there is no nivel3 branch here by design.
// All HR candidates land as `status='proposed'` in `autopilot_actions`,
// with `escalated: true` so the supervisor UI shows them. The caller's
// level is recorded for traceability but does not change the outcome.
//
// This is the 4th of 4 defense layers described in the phase 3 plan:
//   1. UI never offers nivel3 for rrhh (AutopilotConfig.jsx, 3.6)
//   2. PUT /api/autopilot/config rejects `rrhh.nivel='nivel3'` (3.0, PR #270)
//   3. validateGuardrails violates `hr` category on any HR action (3.0)
//   4. This router never invokes `executeAutopilotAction` (here)

const { db, Timestamp } = require('../../lib/firebase');
const { capHrActionLevel } = require('../../lib/hr/hrActionCaps');

async function routeCandidate({
  candidate,
  level,
  fincaId,
  sessionId,
  proposedBy,
  proposedByName,
}) {
  // Even though the cap in the config layer should prevent this, we
  // double-cap here: if anyone passes nivel3, the recorded level
  // drops to nivel2 on the action doc.
  const effectiveLevel = capHrActionLevel(candidate.type, level);

  const actionDocRef = db.collection('autopilot_actions').doc();
  const doc = {
    fincaId,
    sessionId,
    type: candidate.type,
    params: candidate.params,
    titulo: candidate.titulo,
    descripcion: candidate.descripcion,
    prioridad: candidate.prioridad,
    categoria: 'hr',
    // autonomous always false — HR actions never execute autonomously.
    autonomous: false,
    escalated: true,
    status: 'proposed',
    guardrailViolations: null,
    proposedBy: proposedBy || null,
    proposedByName: proposedByName || 'autopilot',
    createdAt: Timestamp.now(),
    reviewedBy: null,
    reviewedByName: null,
    reviewedAt: null,
    rejectionReason: null,
    // Traceability: record the level originally requested AND the
    // effective level after cap, so audit logs show both.
    requestedLevel: level,
    effectiveLevel,
    // HR-specific traceability payload.
    hrRecommendation: candidate.hrRecommendation || null,
  };

  await actionDocRef.set(doc);

  return {
    actionId: actionDocRef.id,
    status: 'proposed',
    type: candidate.type,
    requestedLevel: level,
    effectiveLevel,
    hrRecommendation: doc.hrRecommendation,
  };
}

module.exports = { routeCandidate };
