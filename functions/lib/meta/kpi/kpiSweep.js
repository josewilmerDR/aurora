// KPI sweep — Fase 6.2. I/O heavy; called from the daily cron.
//
// Enumerates finished work (executed autopilot_actions + orchestrator runs)
// whose evaluation windows have elapsed, and writes an observation doc in
// `meta_kpi_observations` for each one. Idempotent via deterministic doc
// IDs — re-running the sweep never creates duplicates, only overwrites
// existing observations with the most recent evaluation.
//
// The sweep is intentionally conservative:
//   - Never evaluates the same (source, window) twice unless explicitly
//     asked (`opts.force = true`).
//   - Skips windows that haven't elapsed yet.
//   - Per-source errors are logged and accounted in the summary; one
//     broken evaluation never stops the sweep.

const { db, Timestamp, FieldValue } = require('../../firebase');
const { ALL_TEMPLATES, windowsFor } = require('./kpiTemplates');
const { evaluateSource, buildObservationDoc } = require('./kpiEvaluator');

const OBSERVATIONS = 'meta_kpi_observations';

// Maps each actionType (and 'orchestrator_run') to all windows registered
// for it, across templates. Computed once at module load.
const WINDOWS_BY_ACTION_TYPE = (() => {
  const map = new Map();
  for (const t of ALL_TEMPLATES) {
    const key = `${t.sourceType}|${t.actionType}`;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(t.window);
  }
  const out = {};
  for (const [k, v] of map) {
    out[k] = Array.from(v).sort((a, b) => a - b);
  }
  return out;
})();

function toDateSafe(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  return null;
}

// ── Enumeration helpers ────────────────────────────────────────────────────

async function listFincasWithAutopilotActions() {
  const snap = await db.collection('autopilot_actions').get();
  const ids = new Set();
  for (const doc of snap.docs) {
    const f = doc.data().fincaId;
    if (typeof f === 'string' && f) ids.add(f);
  }
  return Array.from(ids);
}

async function listFincasWithOrchestratorRuns() {
  const snap = await db.collection('meta_orchestrator_runs').get();
  const ids = new Set();
  for (const doc of snap.docs) {
    const f = doc.data().fincaId;
    if (typeof f === 'string' && f) ids.add(f);
  }
  return Array.from(ids);
}

async function fetchExecutedActions(fincaId) {
  // Reuses the existing `fincaId + createdAt DESC` index. Filtering by
  // status in-memory is fine given expected volumes (tens per day).
  const snap = await db.collection('autopilot_actions')
    .where('fincaId', '==', fincaId)
    .orderBy('createdAt', 'desc')
    .limit(500)
    .get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(a => a.status === 'executed' && a.executedAt);
}

async function fetchOrchestratorRuns(fincaId) {
  const snap = await db.collection('meta_orchestrator_runs')
    .where('fincaId', '==', fincaId)
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function observationExists(docId) {
  const snap = await db.collection(OBSERVATIONS).doc(docId).get();
  return snap.exists;
}

// ── Single-source processing ────────────────────────────────────────────────

// Returns `{ status: 'written'|'skipped'|'pending'|'error', reason? }`.
async function processSource({ source, sourceType, window, fincaId, now, force = false }) {
  const t0 = sourceType === 'orchestrator_run'
    ? toDateSafe(source.createdAt)
    : toDateSafe(source.executedAt);
  if (!t0) return { status: 'skipped', reason: 'no_t0_timestamp' };

  const t1 = new Date(t0.getTime() + window * 86400000);
  if (t1 > now) return { status: 'pending', reason: 'window_not_elapsed', t1 };

  const docId = `${sourceType}_${source.id}_${window}`;
  if (!force && await observationExists(docId)) {
    return { status: 'skipped', reason: 'already_observed' };
  }

  try {
    const evalResult = await evaluateSource({ source, sourceType, window, fincaId, now });
    if (!evalResult.template) {
      return { status: 'skipped', reason: 'no_template' };
    }
    const payload = buildObservationDoc({
      evalResult,
      source,
      sourceType,
      window,
      fincaId,
    });
    // Persist. We set t0/t1/evaluatedAt as Firestore Timestamps for query
    // parity with other collections.
    await db.collection(OBSERVATIONS).doc(docId).set({
      ...payload,
      t0: Timestamp.fromDate(t0),
      t1: Timestamp.fromDate(t1),
      evaluatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status: 'written', outcome: payload.outcome, docId };
  } catch (err) {
    return { status: 'error', reason: err?.message || String(err) };
  }
}

// ── Sweep entrypoints ──────────────────────────────────────────────────────

async function sweepFinca(fincaId, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const force = !!opts.force;

  const summary = {
    fincaId,
    actions: { considered: 0, written: 0, skipped: 0, pending: 0, error: 0 },
    runs:    { considered: 0, written: 0, skipped: 0, pending: 0, error: 0 },
    errors: [],
  };

  // Autopilot actions.
  const actions = await fetchExecutedActions(fincaId);
  for (const action of actions) {
    const windows = WINDOWS_BY_ACTION_TYPE[`autopilot_action|${action.type}`];
    if (!windows) continue;
    for (const window of windows) {
      summary.actions.considered += 1;
      const r = await processSource({
        source: action, sourceType: 'autopilot_action',
        window, fincaId, now, force,
      });
      summary.actions[r.status] = (summary.actions[r.status] || 0) + 1;
      if (r.status === 'error') {
        summary.errors.push({ sourceId: action.id, window, reason: r.reason });
      }
    }
  }

  // Orchestrator runs.
  const runs = await fetchOrchestratorRuns(fincaId);
  for (const run of runs) {
    const windows = WINDOWS_BY_ACTION_TYPE['orchestrator_run|orchestrator_run'];
    if (!windows) continue;
    for (const window of windows) {
      summary.runs.considered += 1;
      const r = await processSource({
        source: run, sourceType: 'orchestrator_run',
        window, fincaId, now, force,
      });
      summary.runs[r.status] = (summary.runs[r.status] || 0) + 1;
      if (r.status === 'error') {
        summary.errors.push({ sourceId: run.id, window, reason: r.reason });
      }
    }
  }

  return summary;
}

async function sweepAll(opts = {}) {
  const [actionFincas, runFincas] = await Promise.all([
    listFincasWithAutopilotActions(),
    listFincasWithOrchestratorRuns(),
  ]);
  const fincaIds = Array.from(new Set([...actionFincas, ...runFincas]));

  const results = [];
  for (const fincaId of fincaIds) {
    try {
      results.push(await sweepFinca(fincaId, opts));
    } catch (err) {
      results.push({
        fincaId,
        actions: { considered: 0, written: 0, skipped: 0, pending: 0, error: 0 },
        runs:    { considered: 0, written: 0, skipped: 0, pending: 0, error: 0 },
        errors: [{ sourceId: null, window: null, reason: err?.message || String(err) }],
      });
    }
  }
  return {
    sweptAt: new Date().toISOString(),
    fincaCount: fincaIds.length,
    summaries: results,
  };
}

module.exports = {
  sweepAll,
  sweepFinca,
  processSource,
  WINDOWS_BY_ACTION_TYPE,
  // Enumerators exposed for tests/routes
  _enumerators: {
    listFincasWithAutopilotActions,
    listFincasWithOrchestratorRuns,
    fetchExecutedActions,
    fetchOrchestratorRuns,
    observationExists,
  },
};
