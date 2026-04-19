// Handlers for `/api/meta/finca-state/...` — Fase 6.0.
//
// The FincaState snapshot is the unified, deterministic view of the finca
// that the Fase 6.1 orchestrator will consume. Sub-fases 6.2 (KPI sweep)
// and 6.3 (trust) will anchor their evaluations against these snapshots.
//
// Endpoints:
//   GET  /api/meta/finca-state/live            — supervisor+, no persist
//   POST /api/meta/finca-state/snapshot        — administrador, persists append-only
//   GET  /api/meta/finca-state/snapshots       — supervisor+, list (newest first)
//   GET  /api/meta/finca-state/snapshots/:id   — supervisor+, single doc

const { db, FieldValue } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE, verifyOwnership } = require('../../lib/helpers');
const { buildFincaState } = require('../../lib/meta/fincaStateBuilder');

const COLLECTION = 'meta_finca_snapshots';
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 25;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^\d{4}-\d{2}$/;

function isValidISODate(s) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidPeriod(s) {
  if (typeof s !== 'string' || !PERIOD_RE.test(s)) return false;
  const [y, m] = s.split('-').map(Number);
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12;
}

function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function parseOptions(source) {
  const opts = {};
  if (source.asOf !== undefined) {
    if (!isValidISODate(source.asOf)) {
      return { error: 'asOf must be YYYY-MM-DD.' };
    }
    opts.asOf = source.asOf;
  }
  if (source.period !== undefined) {
    if (!isValidPeriod(source.period)) {
      return { error: 'period must be YYYY-MM.' };
    }
    opts.period = source.period;
  }
  if (source.horizonWeeks !== undefined) {
    const n = Number(source.horizonWeeks);
    if (!Number.isFinite(n) || n < 1 || n > 26) {
      return { error: 'horizonWeeks must be between 1 and 26.' };
    }
    opts.horizonWeeks = Math.floor(n);
  }
  if (source.lookbackWeeks !== undefined) {
    const n = Number(source.lookbackWeeks);
    if (!Number.isFinite(n) || n < 1 || n > 52) {
      return { error: 'lookbackWeeks must be between 1 and 52.' };
    }
    opts.lookbackWeeks = Math.floor(n);
  }
  return { opts };
}

// ── Live ────────────────────────────────────────────────────────────────────

async function getLiveState(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const parsed = parseOptions(req.query || {});
    if (parsed.error) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, parsed.error, 400);
    }
    const state = await buildFincaState(req.fincaId, parsed.opts);
    res.json({ ...state, snapshotId: null, isLive: true });
  } catch (error) {
    console.error('[META] live finca state failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to build live finca state.', 500);
  }
}

// ── Snapshot create ─────────────────────────────────────────────────────────

async function createSnapshot(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can create snapshots.', 403);
    }
    const parsed = parseOptions(req.body || {});
    if (parsed.error) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, parsed.error, 400);
    }

    const state = await buildFincaState(req.fincaId, parsed.opts);

    const docRef = await db.collection(COLLECTION).add({
      fincaId: req.fincaId,
      generatedBy: req.uid,
      generatedByEmail: req.userEmail || '',
      generatedByRole: req.userRole,
      generatedAt: FieldValue.serverTimestamp(),
      asOf: state.asOf,
      period: state.period,
      horizonWeeks: state.horizonWeeks,
      lookbackWeeks: state.lookbackWeeks,
      finance: state.finance,
      procurement: state.procurement,
      hr: state.hr,
      strategy: state.strategy,
      financing: state.financing,
      inputsHash: state.inputsHash,
      sourceCounts: state.sourceCounts,
      errors: state.errors,
    });

    res.status(201).json({ id: docRef.id, ...state });
  } catch (error) {
    console.error('[META] snapshot create failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create finca state snapshot.', 500);
  }
}

// ── Snapshot list ───────────────────────────────────────────────────────────

async function listSnapshots(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const limit = clampInt(req.query.limit, 1, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT);

    const snap = await db.collection(COLLECTION)
      .where('fincaId', '==', req.fincaId)
      .orderBy('generatedAt', 'desc')
      .limit(limit)
      .get();

    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        asOf: data.asOf,
        period: data.period,
        generatedAt: data.generatedAt?.toDate?.()?.toISOString?.() || null,
        generatedByEmail: data.generatedByEmail || '',
        inputsHash: data.inputsHash,
        horizonWeeks: data.horizonWeeks,
        lookbackWeeks: data.lookbackWeeks,
        // Light summary fields for the list view; full sections are on detail.
        gapCount: data.procurement?.gapCount ?? 0,
        overBudgetCount: data.finance?.budgetExecution?.summary?.overBudgetCount ?? 0,
        minBalance: data.finance?.cashProjection?.minBalance ?? null,
        activePlanVersion: data.strategy?.activeAnnualPlan?.version ?? null,
        hasErrors: !!data.errors,
      };
    });

    res.json(rows);
  } catch (error) {
    console.error('[META] snapshot list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list finca state snapshots.', 500);
  }
}

// ── Snapshot detail ─────────────────────────────────────────────────────────

async function getSnapshot(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const ownership = await verifyOwnership(COLLECTION, req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const data = ownership.doc.data();
    res.json({
      id: ownership.doc.id,
      ...data,
      generatedAt: data.generatedAt?.toDate?.()?.toISOString?.() || null,
    });
  } catch (error) {
    console.error('[META] snapshot get failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch finca state snapshot.', 500);
  }
}

module.exports = {
  getLiveState,
  createSnapshot,
  listSnapshots,
  getSnapshot,
};
