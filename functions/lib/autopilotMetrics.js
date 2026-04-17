/**
 * Autopilot metrics — read-side query layer for observability and alerting.
 *
 * Single source of truth is `autopilot_actions`. We deliberately do NOT
 * maintain a parallel metrics collection: it would create double-write
 * consistency risks for marginal query speedup at this scale. If queries
 * become hot, add per-day rollups later — don't optimise prematurely.
 *
 * Alert cooldown state is kept in a separate `autopilot_alert_state`
 * collection so configuration (intent) and runtime alert bookkeeping
 * (state) stay clearly separated.
 */

const { db, Timestamp } = require('./firebase');

const ACTIONS = 'autopilot_actions';
const ALERT_STATE = 'autopilot_alert_state';

const DEFAULT_HEALTH_WINDOW_HOURS = 24;
const DEFAULT_RECENT_FAILURES_LIMIT = 10;

/**
 * Aggregated counts over a time window. Returns shape:
 *   { windowHours, total, byStatus: {...}, byType: {...}, successRate }
 */
async function getHealthSummary(fincaId, windowHours = DEFAULT_HEALTH_WINDOW_HOURS) {
  const since = Timestamp.fromMillis(Date.now() - windowHours * 60 * 60 * 1000);
  const snap = await db.collection(ACTIONS)
    .where('fincaId', '==', fincaId)
    .where('createdAt', '>=', since)
    .get();

  const byStatus = {};
  const byType = {};
  let totalLatencyMs = 0;
  let withLatency = 0;

  for (const doc of snap.docs) {
    const a = doc.data();
    const status = a.status || 'unknown';
    const type = a.type || 'unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
    if (typeof a.latencyMs === 'number') {
      totalLatencyMs += a.latencyMs;
      withLatency += 1;
    }
  }

  const total = snap.size;
  const executed = byStatus.executed || 0;
  const failed = byStatus.failed || 0;
  const considered = executed + failed;
  const successRate = considered > 0 ? executed / considered : null;

  return {
    windowHours,
    total,
    byStatus,
    byType,
    successRate,
    avgLatencyMs: withLatency > 0 ? Math.round(totalLatencyMs / withLatency) : null,
  };
}

/**
 * Returns the most recent failed actions for triage. Each entry includes
 * just the fields the dashboard needs — keep payloads small.
 */
async function getRecentFailures(fincaId, limit = DEFAULT_RECENT_FAILURES_LIMIT) {
  const snap = await db.collection(ACTIONS)
    .where('fincaId', '==', fincaId)
    .where('status', '==', 'failed')
    .orderBy('executedAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map(doc => {
    const a = doc.data();
    return {
      id: doc.id,
      type: a.type,
      titulo: a.titulo || null,
      executedAt: a.executedAt || null,
      error: a.executionResult?.error || null,
    };
  });
}

/**
 * Counts actions matching a status over the last N minutes. Used by the
 * scheduled monitor to compare against thresholds.
 */
async function countByStatus(fincaId, status, sinceMs) {
  const since = Timestamp.fromMillis(sinceMs);
  const snap = await db.collection(ACTIONS)
    .where('fincaId', '==', fincaId)
    .where('status', '==', status)
    .where('createdAt', '>=', since)
    .count()
    .get();
  return snap.data().count;
}

/**
 * Returns the alert cooldown state for a finca.
 * Shape: { failuresLastAlertAt: Timestamp|null, escalationsLastAlertAt: Timestamp|null }
 */
async function getAlertState(fincaId) {
  const doc = await db.collection(ALERT_STATE).doc(fincaId).get();
  const data = doc.exists ? doc.data() : {};
  return {
    failuresLastAlertAt: data.failuresLastAlertAt || null,
    escalationsLastAlertAt: data.escalationsLastAlertAt || null,
  };
}

/**
 * Marks an alert kind as just-sent so the cron will skip it until the
 * cooldown elapses.
 *   kind: 'failures' | 'escalations'
 */
async function markAlerted(fincaId, kind) {
  if (!['failures', 'escalations'].includes(kind)) {
    throw new Error(`Unknown alert kind: ${kind}`);
  }
  const field = `${kind}LastAlertAt`;
  await db.collection(ALERT_STATE).doc(fincaId).set({
    fincaId,
    [field]: Timestamp.now(),
  }, { merge: true });
}

/**
 * Returns the list of fincaIds that have produced any Autopilot action
 * within the lookback window. Used by the cron to scope per-finca checks.
 */
async function listActiveFincas(sinceMs) {
  const since = Timestamp.fromMillis(sinceMs);
  const snap = await db.collection(ACTIONS)
    .where('createdAt', '>=', since)
    .select('fincaId')
    .get();
  const ids = new Set();
  snap.docs.forEach(d => {
    const fid = d.data().fincaId;
    if (fid) ids.add(fid);
  });
  return Array.from(ids);
}

module.exports = {
  getHealthSummary,
  getRecentFailures,
  countByStatus,
  getAlertState,
  markAlerted,
  listActiveFincas,
};
