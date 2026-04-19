// Chain endpoints — Fase 6.4.
//
//   POST /api/autopilot/orchestrator/chains/plan       supervisor+
//   POST /api/autopilot/orchestrator/chains/:id/execute administrador
//   POST /api/autopilot/orchestrator/chains/:id/abort   administrador
//   GET  /api/autopilot/orchestrator/chains             supervisor+
//   GET  /api/autopilot/orchestrator/chains/:id         supervisor+
//
// The `plan` endpoint: builds a plan (Claude opt-in + deterministic
// fallback), validates it, runs preflight, and persists a `meta_chains`
// doc. It does NOT execute. N1 chains stay at status='planned'; N2/N3
// move straight to preflight and can be executed later.
//
// The `execute` endpoint: gatekept by administrador role. Triggers the
// sequential executor which handles rollback cascades on failure.
//
// The `abort` endpoint: administrator-only. Rolls back any executed
// steps if the chain is running.

const { db, Timestamp, FieldValue } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE, verifyOwnership } = require('../../lib/helpers');
const { stripReasoning } = require('../../lib/autopilotReasoning');

const { buildFincaState } = require('../../lib/meta/fincaStateBuilder');
const { resolveMetaLevel, isMetaDomainActive } = require('../../lib/meta/metaDomainGuards');
const { planChain } = require('../../lib/meta/chains/chainPlanner');
const { validateChain, MAX_CHAIN_STEPS } = require('../../lib/meta/chains/chainValidator');
const { preflightChain } = require('../../lib/meta/chains/chainPreflight');
const { executeChain, abortChain } = require('../../lib/meta/chains/chainExecutor');

const COLLECTION = 'meta_chains';
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 25;
const DEFAULT_EXPIRES_HOURS = 72;

function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// ── POST /chains/plan ──────────────────────────────────────────────────────

async function planHandler(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const body = req.body || {};
    const objective = typeof body.objective === 'string' ? body.objective.trim() : '';
    if (!objective) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'objective (string) is required.', 400);
    }
    const useClaude = String(req.query.useClaude || '') === '1' || body.useClaude === true;
    const hints = typeof body.hints === 'string' ? body.hints.slice(0, 500) : null;

    // Config snapshot
    const configSnap = await db.collection('autopilot_config').doc(req.fincaId).get();
    const config = configSnap.exists ? configSnap.data() : {};
    if (!isMetaDomainActive(config.guardrails || config)) {
      return res.status(423).json({
        ok: false,
        reason: 'Meta domain disabled (kill switch).',
      });
    }
    const requestedLevel = typeof body.level === 'string' ? body.level : null;
    const effectiveLevel = resolveMetaLevel(
      config.guardrails || config,
      requestedLevel || config.mode,
    );

    // FincaState (optionally reuse a snapshot)
    let fincaState;
    let snapshotId = null;
    if (typeof body.snapshotId === 'string' && body.snapshotId) {
      const ownership = await verifyOwnership('meta_finca_snapshots', body.snapshotId, req.fincaId);
      if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
      snapshotId = body.snapshotId;
      fincaState = { ...ownership.doc.data(), fincaId: req.fincaId };
    } else {
      fincaState = await buildFincaState(req.fincaId);
    }

    // Plan
    const planned = await planChain({ fincaState, objective, hints, useClaude });
    const validation = validateChain(planned.plan);

    let preflight = null;
    let status = 'planned';
    if (validation.ok && planned.plan.steps.length > 0) {
      preflight = await preflightChain(planned.plan, req.fincaId);
      status = preflight.ok ? 'preflight_ok' : 'preflight_blocked';
    } else if (!validation.ok) {
      status = 'invalid';
    }

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + DEFAULT_EXPIRES_HOURS * 3600000);

    const doc = {
      fincaId: req.fincaId,
      objective,
      hints,
      createdAt: now,
      createdBy: req.uid || null,
      createdByEmail: req.userEmail || '',
      createdByRole: req.userRole || '',
      requestedLevel,
      effectiveLevel,
      snapshotId,
      stateHash: fincaState.inputsHash || null,
      maxSteps: MAX_CHAIN_STEPS,
      expiresAt,
      plan: {
        steps: planned.plan.steps,
        overallRationale: planned.plan.overallRationale,
        usedClaude: planned.usedClaude,
        source: planned.source,
      },
      reasoning: planned.reasoning,
      validation: validation.ok
        ? { ok: true, orderedStepIds: validation.orderedStepIds }
        : { ok: false, reasons: validation.reasons },
      preflight,
      execution: null,
      status,
    };
    const ref = await db.collection(COLLECTION).add(doc);

    const response = {
      id: ref.id,
      ...doc,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toDate().toISOString(),
    };
    res.status(201).json(hasMinRoleBE(req.userRole, 'supervisor') ? response : stripReasoning(response));
  } catch (error) {
    console.error('[META-CHAIN] plan failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to plan chain.', 500);
  }
}

// ── POST /chains/:id/execute ───────────────────────────────────────────────

async function executeHandler(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can execute chains.', 403);
    }

    // Level check: N1 must not auto-execute.
    const configSnap = await db.collection('autopilot_config').doc(req.fincaId).get();
    const config = configSnap.exists ? configSnap.data() : {};
    const effectiveLevel = resolveMetaLevel(
      config.guardrails || config,
      typeof req.body?.level === 'string' ? req.body.level : config.mode,
    );
    if (effectiveLevel === 'nivel1' || effectiveLevel === 'off') {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        `Chain execution requires meta level nivel2 or nivel3; currently "${effectiveLevel}".`,
        403,
      );
    }

    const result = await executeChain(req.params.id, req.fincaId, {
      uid: req.uid,
      email: req.userEmail,
    });
    if (result.ok) {
      return res.json(result);
    }
    const status =
      result.code === 'NOT_FOUND' ? 404 :
      result.code === 'FORBIDDEN' ? 403 :
      result.code === 'EXPIRED' ? 410 :
      result.code === 'CONFLICT' ? 409 :
      result.code === 'CHAIN_FAILED' ? 200 : 400;
    return res.status(status).json(result);
  } catch (error) {
    console.error('[META-CHAIN] execute failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to execute chain.', 500);
  }
}

// ── POST /chains/:id/abort ─────────────────────────────────────────────────

async function abortHandler(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can abort chains.', 403);
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    const result = await abortChain(req.params.id, req.fincaId, {
      uid: req.uid,
      email: req.userEmail,
    }, { reason });
    if (result.ok) return res.json(result);
    const status =
      result.code === 'NOT_FOUND' ? 404 :
      result.code === 'FORBIDDEN' ? 403 :
      result.code === 'CONFLICT' ? 409 : 400;
    return res.status(status).json(result);
  } catch (error) {
    console.error('[META-CHAIN] abort failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to abort chain.', 500);
  }
}

// ── GET /chains ────────────────────────────────────────────────────────────

async function listHandler(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const limit = clampInt(req.query.limit, 1, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT);
    const snap = await db.collection(COLLECTION)
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        objective: data.objective,
        status: data.status,
        effectiveLevel: data.effectiveLevel,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        createdByEmail: data.createdByEmail || '',
        expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() || null,
        stepCount: data.plan?.steps?.length || 0,
        preflightOk: data.preflight?.ok ?? null,
        usedClaude: !!data.plan?.usedClaude,
      };
    });
    res.json(rows);
  } catch (error) {
    console.error('[META-CHAIN] list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list chains.', 500);
  }
}

// ── GET /chains/:id ────────────────────────────────────────────────────────

async function detailHandler(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const ownership = await verifyOwnership(COLLECTION, req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const data = ownership.doc.data();
    const payload = {
      id: ownership.doc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() || null,
      execution: data.execution ? {
        ...data.execution,
        startedAt: data.execution.startedAt?.toDate?.()?.toISOString?.() || null,
        finishedAt: data.execution.finishedAt?.toDate?.()?.toISOString?.() || null,
        rollback: data.execution.rollback ? {
          ...data.execution.rollback,
          appliedAt: data.execution.rollback.appliedAt?.toDate?.()?.toISOString?.() || null,
        } : null,
      } : null,
    };
    res.json(hasMinRoleBE(req.userRole, 'supervisor') ? payload : stripReasoning(payload));
  } catch (error) {
    console.error('[META-CHAIN] detail failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch chain.', 500);
  }
}

module.exports = {
  planHandler,
  executeHandler,
  abortHandler,
  listHandler,
  detailHandler,
};
