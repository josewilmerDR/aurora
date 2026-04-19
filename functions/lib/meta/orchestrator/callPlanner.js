// Call planner — Fase 6.1. Pure.
//
// Given the urgency signals from `signalDetector`, produces an ordered array
// of "steps" the orchestrator would take. Each step describes either an
// analyzer fan-out (`action: 'run_analyzer'`) or a review item that belongs
// to a human (`action: 'review_...'`). Steps are sorted critical→low and,
// within the same urgency tier, by a stable domain priority that favors the
// cascade: finance first, then procurement, then hr, then strategy, then
// financing.
//
// The planner deliberately does NOT filter by kill switch — that belongs to
// the route layer, which knows the live `autopilot_config`. The planner
// accepts a `domainActive` map to let the caller exclude specific domains.

const { URGENCY_RANK } = require('./signalDetector');

// Stable priority within the same urgency tier. Lower number = higher priority.
const DOMAIN_PRIORITY = Object.freeze({
  finance: 1,
  procurement: 2,
  hr: 3,
  strategy: 4,
  financing: 5,
});

const ALL_DOMAINS = Object.freeze(['finance', 'procurement', 'hr', 'strategy', 'financing']);

// Maps each domain to its specialist action. Domains with no analyzer emit
// a `review_*` step (not auto-executable). Kept here so the route layer
// never has to know the specialist endpoints.
const DOMAIN_ACTIONS = Object.freeze({
  finance: {
    action: 'run_analyzer',
    endpoint: '/api/autopilot/finance/analyze',
    method: 'POST',
    autoExecutable: true,
    defaultBody: () => ({}),
  },
  procurement: {
    action: 'run_analyzer',
    endpoint: '/api/autopilot/procurement/analyze',
    method: 'POST',
    autoExecutable: true,
    defaultBody: () => ({}),
  },
  hr: {
    action: 'run_analyzer',
    endpoint: '/api/autopilot/hr/analyze',
    method: 'POST',
    autoExecutable: true,
    defaultBody: () => ({}),
  },
  strategy: {
    action: 'review_strategy',
    endpoint: null,
    method: null,
    autoExecutable: false,
    defaultBody: () => ({}),
  },
  financing: {
    action: 'review_financing',
    endpoint: null,
    method: null,
    autoExecutable: false,
    defaultBody: () => ({}),
  },
});

const MIN_URGENCY_DEFAULT = 'low';

function joinReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) return '';
  return reasons.join(' ');
}

function buildPlan(signals, options = {}) {
  if (!signals || typeof signals !== 'object') return { steps: [], omittedCount: 0 };

  const domainActive = options.domainActive || {};
  const minUrgency = options.minUrgency || MIN_URGENCY_DEFAULT;
  const minRank = URGENCY_RANK[minUrgency] ?? URGENCY_RANK[MIN_URGENCY_DEFAULT];
  const now = options.now instanceof Date ? options.now : new Date();

  const rawSteps = [];
  let omittedCount = 0;

  for (const domain of ALL_DOMAINS) {
    const signal = signals[domain];
    if (!signal) continue;

    const rank = URGENCY_RANK[signal.urgency] ?? 0;
    if (rank < minRank) {
      if (signal.urgency && signal.urgency !== 'none') omittedCount += 1;
      continue;
    }

    // Explicit domain disable (kill switch at planner level, optional).
    // `undefined` means "not specified" → active; only `false` disables.
    if (domainActive[domain] === false) {
      omittedCount += 1;
      continue;
    }

    const descriptor = DOMAIN_ACTIONS[domain];
    if (!descriptor) continue;

    rawSteps.push({
      domain,
      action: descriptor.action,
      endpoint: descriptor.endpoint,
      method: descriptor.method,
      body: descriptor.defaultBody(now),
      urgency: signal.urgency,
      rationale: joinReasons(signal.reasons) || null,
      autoExecutable: descriptor.autoExecutable,
    });
  }

  // Sort: highest urgency first; ties broken by stable domain priority.
  rawSteps.sort((a, b) => {
    const ra = URGENCY_RANK[a.urgency] || 0;
    const rb = URGENCY_RANK[b.urgency] || 0;
    if (ra !== rb) return rb - ra;
    return (DOMAIN_PRIORITY[a.domain] || 99) - (DOMAIN_PRIORITY[b.domain] || 99);
  });

  return {
    steps: rawSteps,
    omittedCount,
  };
}

// Summary digestible for the persisted run doc. Compact enough to display
// in a list without fetching the full `meta_orchestrator_runs/{id}` doc.
function summarizePlan(plan) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const byUrgency = { critical: 0, high: 0, medium: 0, low: 0 };
  let autoExecutable = 0;
  for (const s of steps) {
    if (byUrgency[s.urgency] != null) byUrgency[s.urgency] += 1;
    if (s.autoExecutable) autoExecutable += 1;
  }
  return {
    stepCount: steps.length,
    byUrgency,
    autoExecutableCount: autoExecutable,
    topUrgency: steps[0]?.urgency || 'none',
    domains: steps.map(s => s.domain),
  };
}

module.exports = {
  buildPlan,
  summarizePlan,
  DOMAIN_PRIORITY,
  DOMAIN_ACTIONS,
  ALL_DOMAINS,
  MIN_URGENCY_DEFAULT,
};
