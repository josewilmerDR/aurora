// Handlers for `/api/meta/kpi-accuracy` + manual sweep trigger — Fase 6.2.
//
// Endpoints:
//   GET  /api/meta/kpi-accuracy      — supervisor+, aggregated hit-rate
//   POST /api/meta/kpi-sweep/run     — administrador, manual sweep trigger

const { db, Timestamp } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE } = require('../../lib/helpers');
const { computeAccuracy } = require('../../lib/meta/kpi/kpiAccuracyAggregator');
const { sweepFinca } = require('../../lib/meta/kpi/kpiSweep');
const { VALID_WINDOWS } = require('../../lib/meta/kpi/kpiTemplates');

const VALID_WINDOW_STRINGS = new Set(VALID_WINDOWS.map(w => String(w)));
const OBSERVATIONS = 'meta_kpi_observations';
const MAX_OBSERVATIONS = 1000; // hard cap per request to protect memory

// ── Accuracy endpoint ───────────────────────────────────────────────────────

async function getAccuracy(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }

    const actionType = typeof req.query.actionType === 'string' ? req.query.actionType : null;
    const window = typeof req.query.window === 'string' ? req.query.window : null;
    const domain = typeof req.query.domain === 'string' ? req.query.domain : null;
    const sinceDays = parseInt(req.query.sinceDays, 10);

    if (window && !VALID_WINDOW_STRINGS.has(window)) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `window must be one of ${VALID_WINDOWS.join(', ')}.`, 400);
    }

    // Only fincaId + evaluatedAt reach Firestore. actionType / window /
    // domain are filtered in memory — avoids the combinatorial explosion
    // of composite indexes for every filter permutation. Expected row
    // counts per finca are in the hundreds, which is comfortable.
    let q = db.collection(OBSERVATIONS)
      .where('fincaId', '==', req.fincaId)
      .orderBy('evaluatedAt', 'desc');
    if (Number.isFinite(sinceDays) && sinceDays > 0) {
      const cutoff = Timestamp.fromDate(new Date(Date.now() - sinceDays * 86400000));
      q = q.where('evaluatedAt', '>=', cutoff);
    }

    const snap = await q.limit(MAX_OBSERVATIONS).get();
    let rows = snap.docs.map(d => d.data());
    if (actionType) rows = rows.filter(r => r.actionType === actionType);
    if (window) rows = rows.filter(r => r.window === Number(window));
    if (domain) rows = rows.filter(r => (r.category || null) === domain);
    const accuracy = computeAccuracy(rows, { actionType, window, domain });

    res.json({
      ...accuracy,
      observationCount: rows.length,
      truncated: rows.length >= MAX_OBSERVATIONS,
    });
  } catch (error) {
    console.error('[META-KPI] accuracy failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute KPI accuracy.', 500);
  }
}

// ── Manual sweep trigger (administrador only) ───────────────────────────────

async function runSweep(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can trigger the sweep.', 403);
    }
    const force = req.body?.force === true;
    const summary = await sweepFinca(req.fincaId, { now: new Date(), force });
    res.json(summary);
  } catch (error) {
    console.error('[META-KPI] manual sweep failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to run KPI sweep.', 500);
  }
}

// ── Observations list (supervisor+, for debugging) ──────────────────────────

async function listObservations(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const snap = await db.collection(OBSERVATIONS)
      .where('fincaId', '==', req.fincaId)
      .orderBy('evaluatedAt', 'desc')
      .limit(limit)
      .get();
    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        actionType: data.actionType,
        window: data.window,
        outcome: data.outcome,
        metric: data.metric,
        detail: data.detail,
        category: data.category || null,
        t0: data.t0?.toDate?.()?.toISOString?.() || null,
        t1: data.t1?.toDate?.()?.toISOString?.() || null,
        evaluatedAt: data.evaluatedAt?.toDate?.()?.toISOString?.() || null,
      };
    });
    res.json(rows);
  } catch (error) {
    console.error('[META-KPI] list observations failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list KPI observations.', 500);
  }
}

module.exports = {
  getAccuracy,
  runSweep,
  listObservations,
};
