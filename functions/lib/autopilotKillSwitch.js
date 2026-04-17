/**
 * Autopilot kill switch — pure domain logic for the global pause flag.
 *
 * The pause flag lives on `autopilot_config/{fincaId}` so it shares the same
 * document as the rest of the Autopilot configuration (single source of truth)
 * but is mutated through dedicated, transactional helpers to avoid races with
 * other config writers.
 *
 * This module exposes no Express concerns. The middleware that gates routes
 * lives in `autopilotMiddleware.js`.
 */

const { db, Timestamp } = require('./firebase');

const COLLECTION = 'autopilot_config';
const REASON_MAX_LEN = 500;

/**
 * Reads the current pause status for a finca.
 * Returns a stable shape even when the config doc does not exist yet.
 */
async function getStatus(fincaId) {
  const doc = await db.collection(COLLECTION).doc(fincaId).get();
  const data = doc.exists ? doc.data() : {};
  return {
    paused: !!data.paused,
    pausedAt: data.pausedAt || null,
    pausedBy: data.pausedBy || null,
    pausedByEmail: data.pausedByEmail || null,
    pausedReason: data.pausedReason || null,
  };
}

/**
 * Lightweight boolean check used by the middleware on the hot path.
 */
async function isPaused(fincaId) {
  const status = await getStatus(fincaId);
  return status.paused;
}

/**
 * Activates the kill switch. Idempotent at the API level: if it is already
 * paused, returns `{ ok: false, alreadyPaused: true }` so callers can decide
 * whether to surface a 409.
 */
async function pause(fincaId, { uid, userEmail, reason }) {
  const ref = db.collection(COLLECTION).doc(fincaId);
  return db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    if (doc.exists && doc.data().paused) {
      return { ok: false, alreadyPaused: true };
    }
    const now = Timestamp.now();
    const trimmedReason = typeof reason === 'string'
      ? reason.trim().slice(0, REASON_MAX_LEN)
      : '';
    const payload = {
      fincaId,
      paused: true,
      pausedAt: now,
      pausedBy: uid || null,
      pausedByEmail: userEmail || null,
      pausedReason: trimmedReason || null,
      updatedAt: now,
    };
    if (!doc.exists) payload.createdAt = now;
    t.set(ref, payload, { merge: true });
    return { ok: true };
  });
}

/**
 * Releases the kill switch. Returns `{ ok: false, notPaused: true }` when there
 * was nothing to resume, mirroring `pause()`'s shape for symmetric handling.
 */
async function resume(fincaId, { uid, userEmail }) {
  const ref = db.collection(COLLECTION).doc(fincaId);
  return db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    if (!doc.exists || !doc.data().paused) {
      return { ok: false, notPaused: true };
    }
    const now = Timestamp.now();
    t.set(ref, {
      paused: false,
      pausedAt: null,
      pausedBy: null,
      pausedByEmail: null,
      pausedReason: null,
      resumedAt: now,
      resumedBy: uid || null,
      resumedByEmail: userEmail || null,
      updatedAt: now,
    }, { merge: true });
    return { ok: true };
  });
}

module.exports = { getStatus, isPaused, pause, resume };
