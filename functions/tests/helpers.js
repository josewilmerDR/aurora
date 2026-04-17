/**
 * Shared helpers for integration tests.
 */

const { db } = require('../lib/firebase');

let counter = 0;

/** Returns a fincaId unique to this test invocation. */
function uniqueFincaId(prefix = 'test') {
  counter += 1;
  return `${prefix}_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Pre-allocates an autopilot_actions doc ref + a synthetic initial doc. */
function newActionContext(fincaId, overrides = {}) {
  const actionDocRef = db.collection('autopilot_actions').doc();
  const sessionRef = db.collection('autopilot_sessions').doc();
  const actionInitialDoc = {
    fincaId,
    sessionId: sessionRef.id,
    type: 'test',
    params: {},
    titulo: 'test action',
    descripcion: 'integration test',
    prioridad: 'media',
    categoria: 'general',
    autonomous: true,
    escalated: false,
    guardrailViolations: null,
    proposedBy: 'test-uid',
    proposedByName: 'test@example.com',
    createdAt: new Date(),
    reviewedBy: null,
    reviewedByName: null,
    reviewedAt: null,
    rejectionReason: null,
    ...overrides,
  };
  return { actionDocRef, actionInitialDoc, sessionId: sessionRef.id };
}

/** Quick Firestore fetch of an autopilot_actions doc. */
async function readAction(actionDocRef) {
  const snap = await actionDocRef.get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/** Finds the compensation linked to an action. */
async function readCompensation(actionId, fincaId) {
  const snap = await db.collection('autopilot_compensations')
    .where('actionId', '==', actionId)
    .where('fincaId', '==', fincaId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ref: snap.docs[0].ref, ...snap.docs[0].data() };
}

/** Best-effort cleanup of a finca's autopilot state. Safe to call even when
 *  nothing is there. */
async function cleanupFinca(fincaId) {
  const collections = [
    'autopilot_actions',
    'autopilot_sessions',
    'autopilot_compensations',
    'autopilot_config',
    'autopilot_alert_state',
    'scheduled_tasks',
    'ordenes_compra',
    'solicitudes_compra',
    'productos',
    'movimientos',
    'counters',
  ];
  for (const name of collections) {
    const snap = name === 'autopilot_config' || name === 'autopilot_alert_state'
      ? await db.collection(name).doc(fincaId).get().then(d => d.exists ? { docs: [d] } : { docs: [] })
      : await db.collection(name).where('fincaId', '==', fincaId).get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    if (snap.docs.length > 0) await batch.commit();
  }
  // counters/oc_{fincaId} is a deterministic doc id
  await db.collection('counters').doc(`oc_${fincaId}`).delete().catch(() => {});
}

module.exports = {
  uniqueFincaId,
  newActionContext,
  readAction,
  readCompensation,
  cleanupFinca,
};
