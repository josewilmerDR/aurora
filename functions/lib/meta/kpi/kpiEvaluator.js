// KPI evaluator — Fase 6.2. Glue between templates and context loader.
//
// Public entry point `evaluateSource()` takes an autopilot_actions doc or
// a meta_orchestrator_runs doc plus a window, looks up the right template,
// loads the context from Firestore, runs the template's pure `evaluate()`,
// and returns an observation payload ready to persist.
//
// The function never throws for normal failure modes (no template, missing
// context, etc.) — those surface as `outcome: 'undetermined'` so the sweep
// can still record the attempt.

const { findTemplate } = require('./kpiTemplates');
const { loadContext } = require('./kpiContextLoader');

// ── Observation doc ID (deterministic) ──────────────────────────────────────

// Shape: `${sourceType}_${sourceId}_${window}`.
// Same source + same window → same doc ID → safe to re-run the sweep.
function observationDocId({ sourceType, sourceId, window }) {
  return `${sourceType}_${sourceId}_${window}`;
}

// ── Timestamp helpers ───────────────────────────────────────────────────────

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

// Returns the T0 timestamp for a source. For autopilot_actions it's
// `executedAt`; for orchestrator runs it's `createdAt`.
function resolveT0(source, sourceType) {
  if (sourceType === 'orchestrator_run') {
    return toDate(source?.createdAt);
  }
  return toDate(source?.executedAt) || toDate(source?.createdAt);
}

// ── Public: build an observation ────────────────────────────────────────────

async function evaluateSource({ source, sourceType, window, fincaId, now }) {
  const evaluatedAt = now instanceof Date ? now : new Date();
  const actionType = sourceType === 'orchestrator_run'
    ? 'orchestrator_run'
    : source?.type || null;

  if (!actionType) {
    return {
      docId: null,
      template: null,
      observation: {
        outcome: 'undetermined',
        detail: 'Source has no actionable `type`.',
        metric: null,
        value: null,
        expected: null,
      },
    };
  }

  const template = findTemplate({ sourceType, actionType, window });
  if (!template) {
    return {
      docId: null,
      template: null,
      observation: {
        outcome: 'undetermined',
        detail: `No KPI template registered for ${sourceType}/${actionType}/${window}d.`,
        metric: null,
        value: null,
        expected: null,
      },
    };
  }

  let ctx;
  try {
    ctx = await loadContext({ template, source, fincaId, now: evaluatedAt });
  } catch (err) {
    return {
      docId: observationDocId({ sourceType, sourceId: source.id, window }),
      template,
      observation: {
        metric: template.metric,
        value: null,
        expected: null,
        outcome: 'undetermined',
        detail: `Context load failed: ${err.message || String(err)}`,
      },
    };
  }

  let obs;
  try {
    obs = template.evaluate(source, ctx);
  } catch (err) {
    obs = {
      metric: template.metric,
      value: null,
      expected: null,
      outcome: 'undetermined',
      detail: `Template evaluate threw: ${err.message || String(err)}`,
    };
  }

  return {
    docId: observationDocId({ sourceType, sourceId: source.id, window }),
    template,
    observation: obs,
    t0: resolveT0(source, sourceType),
    evaluatedAt,
  };
}

// ── Build the Firestore payload for meta_kpi_observations ──────────────────

function buildObservationDoc({ evalResult, source, sourceType, window, fincaId }) {
  const { template, observation, docId, t0, evaluatedAt } = evalResult;
  const actionType = sourceType === 'orchestrator_run' ? 'orchestrator_run' : source?.type;
  return {
    fincaId,
    sourceType,
    sourceId: source?.id || null,
    actionType,
    window,
    t0: t0 || null,
    t1: t0 ? new Date(t0.getTime() + window * 86400000) : null,
    evaluatedAt,
    metric: observation?.metric || template?.metric || null,
    value: observation?.value ?? null,
    expected: observation?.expected ?? null,
    outcome: observation?.outcome || 'undetermined',
    detail: observation?.detail || null,
    // category tag for HR actions to make filtering in the aggregator cheap
    category: source?.categoria || null,
    docId,
  };
}

module.exports = {
  evaluateSource,
  buildObservationDoc,
  observationDocId,
  resolveT0,
};
