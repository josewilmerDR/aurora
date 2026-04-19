// Handlers for `/api/financing/eligibility/...` — Fase 5.3.
//
// `analyze` — administrador only; loads the snapshot + active catalog,
//   runs the deterministic matcher, optionally refines borderline picks
//   with Claude (opt-in via `?useClaude=1`), and persists the full analysis
//   as an append-only doc in `eligibility_analyses`.
//
// `list` / `get` — supervisor+; read the persisted analyses back.
//
// Kill switches honored: global autopilot pause AND financing domain
// kill-switch. Either one triggers HTTP 423 (Locked).

const { db, FieldValue } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE, verifyOwnership } = require('../../lib/helpers');
const { isPaused } = require('../../lib/autopilotKillSwitch');
const {
  summarizeSnapshot,
  rankProducts,
  THRESHOLDS,
} = require('../../lib/financing/eligibilityMatcher');
const { refineWithClaude } = require('../../lib/financing/eligibilityReasoner');
const {
  isFinancingDomainActive,
  assertNivelAllowed,
} = require('../../lib/financing/financingDomainGuards');

// ─── Kill switch checks ───────────────────────────────────────────────────

async function assertAllowed(fincaId) {
  // Global pause — same gate as every other autonomous domain.
  if (await isPaused(fincaId)) {
    return { blocked: true, reason: 'Autopilot paused for this finca.' };
  }
  const cfgDoc = await db.collection('autopilot_config').doc(fincaId).get();
  const cfg = cfgDoc.exists ? cfgDoc.data() : {};
  // Financing-specific domain toggle.
  if (!isFinancingDomainActive(cfg)) {
    return { blocked: true, reason: 'Financing domain disabled (dominios.financing.activo = false).' };
  }
  // Hard-coded N1 policy: reject if the user tried to configure nivel2/3.
  const configuredLevel = cfg?.dominios?.financing?.nivel;
  if (configuredLevel && configuredLevel !== 'nivel1') {
    const check = assertNivelAllowed(configuredLevel);
    if (check.blocked) return { blocked: true, reason: check.reason };
  }
  return { blocked: false };
}

// ─── Analyze ──────────────────────────────────────────────────────────────

async function analyzeEligibility(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can analyze eligibility.', 403);
    }

    const block = await assertAllowed(req.fincaId);
    if (block.blocked) {
      return sendApiError(res, ERROR_CODES.AUTOPILOT_PAUSED, block.reason, 423);
    }

    const body = req.body || {};
    const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId.trim() : '';
    const targetAmount = Number(body.targetAmount);
    const targetUse = typeof body.targetUse === 'string' ? body.targetUse.trim().slice(0, 200) : '';

    if (!snapshotId) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'snapshotId is required.', 400);
    }
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'targetAmount must be > 0.', 400);
    }
    if (!targetUse) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'targetUse is required.', 400);
    }

    // Snapshot — must belong to the caller's finca.
    const ownership = await verifyOwnership('financial_profile_snapshots', snapshotId, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const snapshot = ownership.doc.data();

    // Catalog — only active products for this finca.
    const prodSnap = await db.collection('credit_products')
      .where('fincaId', '==', req.fincaId)
      .get();
    const products = prodSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.activo !== false);

    const summary = summarizeSnapshot(snapshot);
    const deterministic = rankProducts({ summary, products, targetAmount, targetUse });

    // Optional Claude refinement for borderline results. Opt-in to keep the
    // fast path free from API cost unless explicitly requested.
    const useClaude = String(req.query.useClaude || '').toLowerCase() === '1';
    let refinements = [];
    if (useClaude) {
      const borderline = deterministic.filter(
        r => r.score >= THRESHOLDS.SCORE_BORDERLINE && r.score < THRESHOLDS.SCORE_ELIGIBLE
      );
      // Serial to avoid fan-out spikes on Anthropic rate limits. Borderline
      // count is usually 1-3.
      for (const evaluation of borderline) {
        const product = products.find(p => p.id === evaluation.productId);
        if (!product) continue;
        const refined = await refineWithClaude({
          summary, product, evaluation, targetAmount, targetUse,
        });
        if (refined) refinements.push({ productId: evaluation.productId, ...refined });
      }
    }

    // Stamp refinements onto the results by productId.
    const refMap = new Map(refinements.map(r => [r.productId, r]));
    const results = deterministic.map(r => {
      const refined = refMap.get(r.productId);
      if (!refined) return r;
      return {
        ...r,
        claudeRecommendation: refined.recommendation,
        claudeReason: refined.razon,
        claudeConditions: refined.condiciones,
        claudeIssues: refined.puntosACorregir,
        reasoning: refined.reasoning,
      };
    });

    // Persist — append-only.
    const docRef = await db.collection('eligibility_analyses').add({
      fincaId: req.fincaId,
      snapshotId,
      snapshotAsOf: snapshot.asOf || null,
      targetAmount,
      targetUse,
      summary,
      results,
      productsEvaluated: products.length,
      borderlineCount: refinements.length,
      usedClaude: useClaude,
      createdBy: req.uid,
      createdByEmail: req.userEmail || '',
      createdAt: FieldValue.serverTimestamp(),
    });

    res.status(201).json({
      id: docRef.id,
      snapshotId,
      targetAmount,
      targetUse,
      summary,
      results,
      productsEvaluated: products.length,
      usedClaude: useClaude,
    });
  } catch (error) {
    console.error('[FINANCING] eligibility analyze failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to analyze eligibility.', 500);
  }
}

// ─── List ─────────────────────────────────────────────────────────────────

async function listEligibilityAnalyses(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }

    const snap = await db.collection('eligibility_analyses')
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        snapshotId: data.snapshotId,
        snapshotAsOf: data.snapshotAsOf,
        targetAmount: data.targetAmount,
        targetUse: data.targetUse,
        productsEvaluated: data.productsEvaluated || 0,
        borderlineCount: data.borderlineCount || 0,
        usedClaude: !!data.usedClaude,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        createdByEmail: data.createdByEmail || '',
        topScore: Array.isArray(data.results) && data.results.length > 0
          ? data.results[0].score
          : 0,
      };
    });
    res.json(rows);
  } catch (error) {
    console.error('[FINANCING] eligibility list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list eligibility analyses.', 500);
  }
}

// ─── Get one ──────────────────────────────────────────────────────────────

async function getEligibilityAnalysis(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const ownership = await verifyOwnership('eligibility_analyses', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const data = ownership.doc.data();
    res.json({
      id: ownership.doc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
    });
  } catch (error) {
    console.error('[FINANCING] eligibility get failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch eligibility analysis.', 500);
  }
}

module.exports = {
  analyzeEligibility,
  listEligibilityAnalyses,
  getEligibilityAnalysis,
  // exported for tests
  _internals: { assertAllowed },
};
