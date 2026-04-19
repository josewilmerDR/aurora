// POST /api/autopilot/orchestrator/analyze — Fase 6.1.
//
// Runs the meta orchestrator:
//   1. Reads autopilot_config (kill switches + meta level + domain states).
//   2. Builds (or reuses) a FincaState snapshot.
//   3. Runs signalDetector → callPlanner to produce a deterministic plan.
//   4. Optionally refines with Claude (?useClaude=1, opt-in, fallback to
//      deterministic on any failure).
//   5. Resolves the effective meta level:
//        - off / nivel1 → plan is emitted, no fan-out (status='proposed').
//        - nivel2 / nivel3 → dispatches auto-executable steps to the
//          corresponding analyzer handlers via synthetic req/res. Each
//          specialist analyzer still respects its OWN kill switch and
//          level cap (HR stays ≤ nivel2, financing stays at nivel1).
//   6. Persists the run in `meta_orchestrator_runs` (append-only).
//
// Additionally this file exposes list/detail handlers to read past runs.

const { db, Timestamp, FieldValue } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE, verifyOwnership } = require('../../lib/helpers');
const { isPaused: isAutopilotPaused } = require('../../lib/autopilotKillSwitch');
const { stripReasoning } = require('../../lib/autopilotReasoning');

const { buildFincaState } = require('../../lib/meta/fincaStateBuilder');
const {
  isMetaDomainActive,
  resolveMetaLevel,
} = require('../../lib/meta/metaDomainGuards');
const { detectSignals } = require('../../lib/meta/orchestrator/signalDetector');
const { buildPlan, summarizePlan } = require('../../lib/meta/orchestrator/callPlanner');
const { refineWithClaude } = require('../../lib/meta/orchestrator/claudePlanner');
const { invokeAnalyzer } = require('./invokeAnalyzer');

const { analyze: financeAnalyze } = require('../autopilot-finance/analyze');
const { analyze: procurementAnalyze } = require('../autopilot-procurement/analyze');
const { analyze: hrAnalyze } = require('../autopilot-hr/analyze');

const COLLECTION = 'meta_orchestrator_runs';
const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;

// Maps each `run_analyzer` step's domain to the handler function.
const ANALYZER_HANDLERS = Object.freeze({
  finance: financeAnalyze,
  procurement: procurementAnalyze,
  hr: hrAnalyze,
});

// Per-domain kill switch readers used to prune the plan before dispatch.
function isDomainActive(domain, config) {
  const d = config?.dominios?.[canonicalDomainKey(domain)];
  if (!d) return true;
  return d.activo !== false;
}

// The config's `dominios` keys don't always match our domain names 1:1.
// `rrhh` is the legacy key for `hr`, `financiera` for `finance`, etc.
function canonicalDomainKey(domain) {
  switch (domain) {
    case 'hr': return 'rrhh';
    case 'finance': return 'financiera';
    default: return domain;
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

async function analyze(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }

    const fincaId = req.fincaId;
    const body = req.body || {};
    const useClaude = String(req.query.useClaude || '') === '1';
    const dryRun = String(req.query.dryRun || '') === '1';

    // Global kill switch first — defense in depth before we read config.
    if (await isAutopilotPaused(fincaId)) {
      return sendApiError(res, ERROR_CODES.AUTOPILOT_PAUSED, 'Autopilot is paused for this finca.', 423);
    }

    // Config → kill switches, level.
    const configSnap = await db.collection('autopilot_config').doc(fincaId).get();
    const config = configSnap.exists ? configSnap.data() : {};

    if (!isMetaDomainActive(config.guardrails || config)) {
      return res.json({
        ran: false,
        reason: 'Dominio meta desactivado (kill switch).',
        steps: [],
      });
    }

    // Resolve FincaState. When `snapshotId` is provided, reuse that exact
    // snapshot — this is the mechanism that lets the KPI sweep (6.2) and
    // chain executor (6.4) anchor their evaluations to a fixed state.
    let fincaState;
    let snapshotId = null;
    if (typeof body.snapshotId === 'string' && body.snapshotId) {
      const ownership = await verifyOwnership('meta_finca_snapshots', body.snapshotId, fincaId);
      if (!ownership.ok) {
        return sendApiError(res, ownership.code, ownership.message, ownership.status);
      }
      snapshotId = body.snapshotId;
      const data = ownership.doc.data();
      fincaState = {
        fincaId: data.fincaId,
        asOf: data.asOf,
        period: data.period,
        horizonWeeks: data.horizonWeeks,
        lookbackWeeks: data.lookbackWeeks,
        finance: data.finance,
        procurement: data.procurement,
        hr: data.hr,
        strategy: data.strategy,
        financing: data.financing,
        inputsHash: data.inputsHash,
        sourceCounts: data.sourceCounts,
        errors: data.errors,
      };
    } else {
      fincaState = await buildFincaState(fincaId, {
        asOf: body.asOf,
        period: body.period,
        horizonWeeks: body.horizonWeeks,
        lookbackWeeks: body.lookbackWeeks,
      });
    }

    // Signals → deterministic plan, pruning paused domains.
    const signals = detectSignals(fincaState, { thresholds: body.thresholds });
    const domainActive = {
      finance: isDomainActive('finance', config),
      procurement: isDomainActive('procurement', config),
      hr: isDomainActive('hr', config),
      strategy: isDomainActive('strategy', config),
      financing: isDomainActive('financing', config),
    };
    const deterministicPlan = buildPlan(signals, { domainActive });

    // Optional Claude refinement. Never fatal — fall back to deterministic.
    let claudeReview = null;
    let adjustments = null;
    let reasoning = null;
    let finalSteps = deterministicPlan.steps.slice();
    if (useClaude && finalSteps.length > 0) {
      const refined = await refineWithClaude({ fincaState, plan: deterministicPlan });
      if (refined) {
        claudeReview = refined.review;
        adjustments = refined.adjustments;
        reasoning = refined.reasoning;
        finalSteps = refined.refinedSteps;
      }
    }

    const requestedLevel = typeof body.level === 'string' ? body.level : null;
    const effectiveLevel = resolveMetaLevel(
      config.guardrails || config,
      requestedLevel || config.mode,
    );

    const canFanOut = !dryRun
      && (effectiveLevel === 'nivel2' || effectiveLevel === 'nivel3')
      && finalSteps.length > 0;

    // Fan-out. Each analyzer respects its own kill switch + level cap — the
    // orchestrator just kicks them off and captures the response body.
    const fanOutResults = [];
    let fanOutStartedAt = null;
    let fanOutFinishedAt = null;

    if (canFanOut) {
      fanOutStartedAt = Timestamp.now();
      for (const step of finalSteps) {
        if (!step.autoExecutable) {
          fanOutResults.push({
            domain: step.domain,
            action: step.action,
            status: 'skipped',
            reason: 'Step is not auto-executable (review-only).',
          });
          continue;
        }
        const handler = ANALYZER_HANDLERS[step.domain];
        if (!handler) {
          fanOutResults.push({
            domain: step.domain,
            action: step.action,
            status: 'skipped',
            reason: `No analyzer handler registered for domain "${step.domain}".`,
          });
          continue;
        }
        const stepStart = Date.now();
        const result = await invokeAnalyzer(handler, req, step.body);
        fanOutResults.push({
          domain: step.domain,
          action: step.action,
          status: result.statusCode >= 200 && result.statusCode < 300 ? 'ok' : 'error',
          statusCode: result.statusCode,
          response: result.body,
          latencyMs: Date.now() - stepStart,
        });
      }
      fanOutFinishedAt = Timestamp.now();
    }

    // Persist the run.
    const runRef = db.collection(COLLECTION).doc();
    const status = !canFanOut
      ? 'proposed'
      : fanOutResults.every(r => r.status !== 'error')
        ? 'dispatched'
        : 'partial';

    const runDoc = {
      fincaId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.uid || null,
      createdByEmail: req.userEmail || '',
      createdByRole: req.userRole || '',
      requestedLevel: requestedLevel,
      effectiveLevel,
      snapshotId,
      stateHash: fincaState.inputsHash,
      asOf: fincaState.asOf,
      period: fincaState.period,
      signals,
      deterministicPlan,
      claudeReview,
      adjustments,
      reasoning,
      finalSteps,
      summary: summarizePlan({ steps: finalSteps }),
      fanOut: {
        enabled: canFanOut,
        dryRun,
        startedAt: fanOutStartedAt,
        finishedAt: fanOutFinishedAt,
        results: fanOutResults,
      },
      status,
      usedClaude: !!reasoning,
    };
    await runRef.set(runDoc);

    // Strip `reasoning` if the caller is below supervisor+ (currently the
    // route is supervisor-gated, but the helper is cheap and explicit).
    const responseBody = hasMinRoleBE(req.userRole, 'supervisor')
      ? runDoc
      : stripReasoning(runDoc);

    return res.status(201).json({
      runId: runRef.id,
      ...responseBody,
      fanOut: {
        ...runDoc.fanOut,
        startedAt: fanOutStartedAt?.toDate?.()?.toISOString?.() || null,
        finishedAt: fanOutFinishedAt?.toDate?.()?.toISOString?.() || null,
      },
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[META-ORCHESTRATOR] analyze failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to run meta orchestrator.', 500);
  }
}

// ── List ────────────────────────────────────────────────────────────────────

function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

async function listRuns(req, res) {
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
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        createdByEmail: data.createdByEmail || '',
        effectiveLevel: data.effectiveLevel,
        status: data.status,
        asOf: data.asOf,
        period: data.period,
        stateHash: data.stateHash,
        stepCount: data.summary?.stepCount ?? 0,
        topUrgency: data.summary?.topUrgency ?? 'none',
        fanOutEnabled: !!data.fanOut?.enabled,
        usedClaude: !!data.usedClaude,
      };
    });
    res.json(rows);
  } catch (error) {
    console.error('[META-ORCHESTRATOR] list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list orchestrator runs.', 500);
  }
}

async function getRun(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const ownership = await verifyOwnership(COLLECTION, req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const data = ownership.doc.data();
    const payload = hasMinRoleBE(req.userRole, 'supervisor')
      ? data
      : stripReasoning(data);

    res.json({
      id: ownership.doc.id,
      ...payload,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
      fanOut: data.fanOut ? {
        ...data.fanOut,
        startedAt: data.fanOut.startedAt?.toDate?.()?.toISOString?.() || null,
        finishedAt: data.fanOut.finishedAt?.toDate?.()?.toISOString?.() || null,
      } : null,
    });
  } catch (error) {
    console.error('[META-ORCHESTRATOR] detail failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch orchestrator run.', 500);
  }
}

module.exports = {
  analyze,
  listRuns,
  getRun,
  // Exported for tests.
  _internals: { canonicalDomainKey, isDomainActive, ANALYZER_HANDLERS },
};
