// KPI accuracy aggregator — Fase 6.2. Pure.
//
// Mirrors `hr/accuracyCalculator.computeAccuracy` but operates over
// `meta_kpi_observations` rows spanning ALL domains. The aggregator
// computes hit-rate per (actionType, window) and overall.
//
// Outcome accounting:
//   - match         → +1 in hit-rate numerator, +1 in denominator
//   - miss          → +0 numerator, +1 denominator
//   - partial       → +0.5 numerator, +1 denominator (soft credit)
//   - undetermined  → does not count (missing/corrupt data)
//   - pending       → does not count (waiting for human ground truth)
//
// Hit-rate is `null` when denominator = 0 (distinct from `0.0` — pending
// sample set is not a failing sample set).

function clampRate(numerator, denominator) {
  if (!denominator) return null;
  const v = numerator / denominator;
  return Math.round(v * 1000) / 1000;
}

function emptyBucket() {
  return {
    match: 0,
    miss: 0,
    partial: 0,
    undetermined: 0,
    pending: 0,
    total: 0,
  };
}

function decorate(agg) {
  const decided = agg.match + agg.miss + agg.partial;
  const numerator = agg.match + agg.partial * 0.5;
  return {
    ...agg,
    decidedCount: decided,
    hitRate: clampRate(numerator, decided),
  };
}

function computeAccuracy(observations, opts = {}) {
  const rows = Array.isArray(observations) ? observations : [];
  const byActionType = {};
  const byWindow = {};
  const byDomain = {};
  const all = emptyBucket();

  for (const row of rows) {
    const outcome = row?.outcome;
    if (!outcome || !Object.prototype.hasOwnProperty.call(all, outcome)) continue;

    all[outcome] += 1;
    all.total += 1;

    const at = row?.actionType || 'unknown';
    if (!byActionType[at]) byActionType[at] = emptyBucket();
    byActionType[at][outcome] += 1;
    byActionType[at].total += 1;

    const w = row?.window;
    if (w != null) {
      const key = String(w);
      if (!byWindow[key]) byWindow[key] = emptyBucket();
      byWindow[key][outcome] += 1;
      byWindow[key].total += 1;
    }

    const domain = row?.category || row?.domain || null;
    if (domain) {
      if (!byDomain[domain]) byDomain[domain] = emptyBucket();
      byDomain[domain][outcome] += 1;
      byDomain[domain].total += 1;
    }
  }

  return {
    overall: decorate(all),
    byActionType: decorateMap(byActionType),
    byWindow: decorateMap(byWindow),
    byDomain: decorateMap(byDomain),
    filters: {
      actionType: opts.actionType || null,
      window: opts.window || null,
      domain: opts.domain || null,
    },
  };
}

function decorateMap(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) out[k] = decorate(v);
  return out;
}

module.exports = {
  computeAccuracy,
  // Exported for tests
  decorate,
  emptyBucket,
  clampRate,
};
