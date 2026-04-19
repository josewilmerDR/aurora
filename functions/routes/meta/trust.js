// Handlers for `/api/meta/trust/...` and `/api/meta/guardrails/proposals/...`
// — Fase 6.3.
//
// Endpoints:
//   GET  /api/meta/trust/scores                                — supervisor+
//   POST /api/meta/trust/recompute                             — administrador
//   GET  /api/meta/guardrails/proposals                        — supervisor+
//   POST /api/meta/guardrails/proposals/:id/approve            — administrador
//   POST /api/meta/guardrails/proposals/:id/reject             — administrador
//   GET  /api/meta/trust/corridor                              — supervisor+

const { db, Timestamp } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE, verifyOwnership } = require('../../lib/helpers');
const { computeTrustScores } = require('../../lib/meta/trust/trustScorer');
const {
  recomputeAndPropose,
  loadRecentObservations,
  DEFAULT_LOOKBACK_DAYS,
} = require('../../lib/meta/trust/trustManager');
const { CORRIDOR, CORRIDOR_KEYS, FORBIDDEN_CORRIDOR_KEYS } = require('../../lib/meta/trust/corridor');
const { executeAutopilotAction } = require('../../lib/autopilotActions');

const AUTOPILOT_ACTIONS = 'autopilot_actions';

// ── GET /trust/scores ───────────────────────────────────────────────────────

async function getScores(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const sinceDays = Math.min(Math.max(parseInt(req.query.sinceDays, 10) || DEFAULT_LOOKBACK_DAYS, 1), 730);
    const observations = await loadRecentObservations(req.fincaId, { sinceDays, limit: 1000 });
    const scores = computeTrustScores(observations, { now: new Date() });
    res.json({
      ...scores,
      observationCount: observations.length,
      sinceDays,
    });
  } catch (error) {
    console.error('[META-TRUST] scores failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute trust scores.', 500);
  }
}

// ── POST /trust/recompute ───────────────────────────────────────────────────

async function recompute(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can recompute trust.', 403);
    }
    const out = await recomputeAndPropose(req.fincaId, {
      now: new Date(),
      level: typeof req.body?.level === 'string' ? req.body.level : null,
      sinceDays: Number(req.body?.sinceDays) || undefined,
      actor: { uid: req.uid, email: req.userEmail },
    });
    res.json(out);
  } catch (error) {
    console.error('[META-TRUST] recompute failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to recompute trust.', 500);
  }
}

// ── GET /guardrails/proposals ───────────────────────────────────────────────

async function listProposals(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const snap = await db.collection(AUTOPILOT_ACTIONS)
      .where('fincaId', '==', req.fincaId)
      .where('type', '==', 'ajustar_guardrails')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        status: data.status,
        direction: data.params?.direction || null,
        key: data.params?.key || null,
        currentValue: data.params?.previousValue ?? null,
        proposedValue: data.params?.newValue ?? null,
        trustInput: data.params?.trustInput || null,
        domains: data.params?.domains || [],
        unit: data.params?.unit || null,
        titulo: data.titulo || null,
        descripcion: data.descripcion || null,
        autonomous: !!data.autonomous,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        executedAt: data.executedAt?.toDate?.()?.toISOString?.() || null,
        reviewedAt: data.reviewedAt?.toDate?.()?.toISOString?.() || null,
        reviewedBy: data.reviewedByName || null,
        rejectionReason: data.rejectionReason || null,
        rolledBack: !!data.rolledBack,
      };
    });
    res.json(rows);
  } catch (error) {
    console.error('[META-TRUST] list proposals failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list guardrail proposals.', 500);
  }
}

// ── POST /guardrails/proposals/:id/approve ──────────────────────────────────

async function approveProposal(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can approve proposals.', 403);
    }
    const ownership = await verifyOwnership(AUTOPILOT_ACTIONS, req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const data = ownership.doc.data();
    if (data.type !== 'ajustar_guardrails') {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Action is not a guardrail proposal.', 400);
    }
    if (data.status !== 'proposed') {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Proposal cannot be approved from status "${data.status}".`, 400);
    }

    try {
      const result = await executeAutopilotAction(
        'ajustar_guardrails',
        data.params,
        req.fincaId,
        {
          actionDocRef: ownership.doc.ref,
          // Existing doc — do not pass actionInitialDoc; the executor will update the existing record in place.
        },
      );
      await ownership.doc.ref.update({
        reviewedBy: req.uid || null,
        reviewedByName: req.userEmail || '',
        reviewedAt: Timestamp.now(),
      });
      res.json({ ok: true, result });
    } catch (execErr) {
      return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, execErr?.message || 'Failed to execute action.', 500);
    }
  } catch (error) {
    console.error('[META-TRUST] approve failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to approve guardrail proposal.', 500);
  }
}

// ── POST /guardrails/proposals/:id/reject ───────────────────────────────────

async function rejectProposal(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can reject proposals.', 403);
    }
    const ownership = await verifyOwnership(AUTOPILOT_ACTIONS, req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const data = ownership.doc.data();
    if (data.type !== 'ajustar_guardrails') {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Action is not a guardrail proposal.', 400);
    }
    if (data.status !== 'proposed') {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Proposal cannot be rejected from status "${data.status}".`, 400);
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 512) : '';
    await ownership.doc.ref.update({
      status: 'rejected',
      rejectionReason: reason || null,
      reviewedBy: req.uid || null,
      reviewedByName: req.userEmail || '',
      reviewedAt: Timestamp.now(),
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('[META-TRUST] reject failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to reject guardrail proposal.', 500);
  }
}

// ── GET /trust/corridor ─────────────────────────────────────────────────────

async function getCorridor(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const entries = CORRIDOR_KEYS.map(key => ({ key, ...CORRIDOR[key] }));
    res.json({
      entries,
      forbiddenKeys: FORBIDDEN_CORRIDOR_KEYS,
    });
  } catch (error) {
    console.error('[META-TRUST] corridor failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to read corridor.', 500);
  }
}

module.exports = {
  getScores,
  recompute,
  listProposals,
  approveProposal,
  rejectProposal,
  getCorridor,
};
