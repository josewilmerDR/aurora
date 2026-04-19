// Trust manager — Fase 6.3. Glue layer (I/O + orchestration).
//
// Ties together the pure libs:
//   - trustScorer.js      → computeTrustScores
//   - corridor.js          → bounds
//   - guardrailDelta.js    → proposeGuardrailDelta
//
// plus the existing autopilot plumbing (autopilot_config, autopilot_actions,
// executeAutopilotAction) to implement the 6.3 contract:
//
//   N1: every proposal lands as `autopilot_actions` doc with
//       status='proposed'. Nothing auto-applies.
//   N2: tightening proposals auto-apply. Relaxations remain proposed.
//   N3: both directions auto-apply. Each relaxation emits an
//       `autopilot_actions.executed` doc; admin still has the standard
//       rollback window to undo if it was the wrong call.
//
// The meta domain's own kill switch + global kill switch are respected
// by `executeAutopilotAction` defense-in-depth, so we don't re-check here.

const { db, Timestamp, FieldValue } = require('../../firebase');
const { computeTrustScores } = require('./trustScorer');
const { proposeGuardrailDelta } = require('./guardrailDelta');
const { resolveMetaLevel, isMetaDomainActive } = require('../metaDomainGuards');
const { executeAutopilotAction } = require('../../autopilotActions');

const OBSERVATIONS = 'meta_kpi_observations';
const AUTOPILOT_ACTIONS = 'autopilot_actions';
const AUTOPILOT_CONFIG = 'autopilot_config';

const DEFAULT_LOOKBACK_DAYS = 365;
const DEFAULT_OBSERVATION_LIMIT = 1000;

// ── Observation loader ─────────────────────────────────────────────────────

async function loadRecentObservations(fincaId, { sinceDays = DEFAULT_LOOKBACK_DAYS, limit = DEFAULT_OBSERVATION_LIMIT } = {}) {
  const cutoff = Timestamp.fromDate(new Date(Date.now() - sinceDays * 86400000));
  const snap = await db.collection(OBSERVATIONS)
    .where('fincaId', '==', fincaId)
    .orderBy('evaluatedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs
    .map(d => d.data())
    .filter(row => {
      const t = row.evaluatedAt?.toMillis?.() ?? 0;
      return t >= cutoff.toMillis();
    });
}

// ── Level → action policy ──────────────────────────────────────────────────

// Given the resolved meta level and the direction of a proposal, returns
// whether the trust manager should auto-apply it or persist it as a
// recommendation awaiting approval.
function shouldAutoApply(proposal, effectiveLevel) {
  const dir = proposal?.direction;
  if (dir !== 'relax' && dir !== 'tighten') return false;
  if (effectiveLevel === 'nivel3') return true;
  if (effectiveLevel === 'nivel2' && dir === 'tighten') return true;
  return false;
}

// ── Writers ────────────────────────────────────────────────────────────────

function buildActionParams(proposal) {
  return {
    key: proposal.key,
    newValue: proposal.proposedValue,
    previousValue: proposal.currentValue,
    direction: proposal.direction,
    trustInput: proposal.trustInput,
    corridor: proposal.corridor,
    unit: proposal.unit,
    domains: proposal.domains,
  };
}

function buildTitle(proposal) {
  const verb = proposal.direction === 'relax' ? 'Relajar' : 'Endurecer';
  return `${verb} ${proposal.key} (${proposal.currentValue} → ${proposal.proposedValue})`;
}

async function persistProposal({ fincaId, proposal, actor, sessionId, effectiveLevel }) {
  const ref = db.collection(AUTOPILOT_ACTIONS).doc();
  await ref.set({
    fincaId,
    sessionId: sessionId || null,
    type: 'ajustar_guardrails',
    params: buildActionParams(proposal),
    titulo: buildTitle(proposal),
    descripcion: `Trust ${proposal.trustInput.trust} (confianza ${proposal.trustInput.confidence}). Dominios: ${proposal.domains.join(', ')}.`,
    prioridad: 'media',
    categoria: 'meta',
    autonomous: false,
    escalated: true,
    guardrailViolations: null,
    status: 'proposed',
    proposedBy: actor?.uid || null,
    proposedByName: actor?.email || 'trust-manager',
    createdAt: Timestamp.now(),
    reviewedBy: null,
    reviewedByName: null,
    reviewedAt: null,
    rejectionReason: null,
  });
  return ref.id;
}

async function dispatchAutoApply({ fincaId, proposal, actor, sessionId, effectiveLevel }) {
  const actionDocRef = db.collection(AUTOPILOT_ACTIONS).doc();
  const baseDoc = {
    fincaId,
    sessionId: sessionId || null,
    type: 'ajustar_guardrails',
    params: buildActionParams(proposal),
    titulo: buildTitle(proposal),
    descripcion: `Auto-aplicado por trust manager (nivel ${effectiveLevel}). Trust ${proposal.trustInput.trust}.`,
    prioridad: 'media',
    categoria: 'meta',
    autonomous: true,
    escalated: false,
    guardrailViolations: null,
    proposedBy: actor?.uid || null,
    proposedByName: actor?.email || 'trust-manager',
    createdAt: Timestamp.now(),
    reviewedBy: null,
    reviewedByName: null,
    reviewedAt: null,
    rejectionReason: null,
  };
  try {
    const result = await executeAutopilotAction(
      'ajustar_guardrails',
      buildActionParams(proposal),
      fincaId,
      { actionDocRef, actionInitialDoc: baseDoc, level: effectiveLevel },
    );
    return { status: 'executed', actionId: actionDocRef.id, result };
  } catch (err) {
    // Fall back to "proposed" when execution fails — admins can still
    // approve manually later or investigate the reason.
    console.error('[TRUST-MANAGER] auto-apply failed, falling back to proposed:', err?.message);
    try {
      await actionDocRef.set({
        ...baseDoc,
        status: 'proposed',
        autonomous: false,
        escalated: true,
        guardrailViolations: [String(err?.message || err)],
      });
    } catch (_) {
      // Best effort only.
    }
    return { status: 'proposed', actionId: actionDocRef.id, error: err?.message || String(err) };
  }
}

// ── Main entry points ─────────────────────────────────────────────────────

async function recomputeAndPropose(fincaId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const actor = options.actor || null;

  const configSnap = await db.collection(AUTOPILOT_CONFIG).doc(fincaId).get();
  const config = configSnap.exists ? configSnap.data() : {};

  if (!isMetaDomainActive(config.guardrails || config)) {
    return {
      fincaId,
      ran: false,
      reason: 'Meta domain disabled (kill switch).',
      proposals: [],
    };
  }

  const requestedLevel = typeof options.level === 'string' ? options.level : null;
  const effectiveLevel = resolveMetaLevel(
    config.guardrails || config,
    requestedLevel || config.mode,
  );

  const observations = await loadRecentObservations(fincaId, {
    sinceDays: options.sinceDays || DEFAULT_LOOKBACK_DAYS,
    limit: options.limit || DEFAULT_OBSERVATION_LIMIT,
  });
  const trustScores = computeTrustScores(observations, { now });

  const currentGuardrails = config.guardrails || {};
  const delta = proposeGuardrailDelta(currentGuardrails, trustScores);

  const sessionId = `trust-${Date.now()}`;
  const results = [];
  for (const proposal of delta.proposals) {
    if (shouldAutoApply(proposal, effectiveLevel)) {
      const out = await dispatchAutoApply({ fincaId, proposal, actor, sessionId, effectiveLevel });
      results.push({ ...proposal, ...out });
    } else {
      const actionId = await persistProposal({ fincaId, proposal, actor, sessionId, effectiveLevel });
      results.push({ ...proposal, status: 'proposed', actionId });
    }
  }

  // Persist a session row so the UI can group recomputes.
  if (results.length > 0) {
    await db.collection('autopilot_sessions').doc(sessionId).set({
      fincaId,
      kind: 'trust_recompute',
      startedAt: Timestamp.now(),
      finishedAt: Timestamp.now(),
      actionCount: results.length,
      proposedCount: results.filter(r => r.status === 'proposed').length,
      executedCount: results.filter(r => r.status === 'executed').length,
      level: effectiveLevel,
    }, { merge: true });
  }

  return {
    fincaId,
    ran: true,
    effectiveLevel,
    trustScores,
    proposals: results,
    observationCount: observations.length,
    sessionId,
  };
}

// Used by the cron to enumerate fincas with at least one observation. Same
// strategy as Fase 6.2's sweep — keep things simple; for a single-finca
// deployment this is a constant-time scan.
async function listFincasWithObservations() {
  const snap = await db.collection(OBSERVATIONS).get();
  const ids = new Set();
  for (const doc of snap.docs) {
    const f = doc.data().fincaId;
    if (typeof f === 'string' && f) ids.add(f);
  }
  return Array.from(ids);
}

module.exports = {
  recomputeAndPropose,
  listFincasWithObservations,
  loadRecentObservations,
  shouldAutoApply,
  buildActionParams,
  buildTitle,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_OBSERVATION_LIMIT,
};
