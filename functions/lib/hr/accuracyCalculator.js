// HR recommendations accuracy calculator — pure.
//
// Takes an array of `hr_recommendations_audit` docs and derives the
// "how often Aurora was right" metric that sits behind the phase 3
// exit criterion (90% accuracy vs. human decisions over 6 months).
//
// Two levels of ground truth:
//   1. humanResolution: approved | rejected | ignored (captured when
//      the supervisor acts on the proposal)
//   2. outcomeMatchedReality: boolean | null (filled retrospectively
//      by the admin after observing what actually happened — e.g.
//      "did we end up hiring?" or "was the alert useful?")
//
// `hitRate` requires outcomeMatchedReality=true or false. `null` rows
// are "verdict pending" and do not count toward the ratio.

const VALID_RESOLUTIONS = new Set(['approved', 'rejected', 'ignored']);

function clampHitRate(numerator, denominator) {
  if (!denominator) return null;
  const v = numerator / denominator;
  return Math.round(v * 1000) / 1000; // 3 decimals
}

function isResolvedWithOutcome(row) {
  return typeof row?.outcomeMatchedReality === 'boolean';
}

function computeAccuracy(auditRows, opts = {}) {
  const rows = Array.isArray(auditRows) ? auditRows : [];
  const byType = {};
  const allAgg = {
    approved: 0, rejected: 0, ignored: 0,
    outcomeMatched: 0, outcomeUnmatched: 0, pending: 0,
    total: rows.length,
  };

  for (const row of rows) {
    const type = typeof row?.type === 'string' ? row.type : 'unknown';
    if (!byType[type]) {
      byType[type] = {
        approved: 0, rejected: 0, ignored: 0,
        outcomeMatched: 0, outcomeUnmatched: 0, pending: 0,
        total: 0,
      };
    }

    byType[type].total += 1;
    const resolution = row?.humanResolution;
    if (VALID_RESOLUTIONS.has(resolution)) {
      byType[type][resolution] += 1;
      allAgg[resolution] += 1;
    }

    if (isResolvedWithOutcome(row)) {
      if (row.outcomeMatchedReality === true) {
        byType[type].outcomeMatched += 1;
        allAgg.outcomeMatched += 1;
      } else {
        byType[type].outcomeUnmatched += 1;
        allAgg.outcomeUnmatched += 1;
      }
    } else {
      byType[type].pending += 1;
      allAgg.pending += 1;
    }
  }

  const decorateHitRate = (agg) => {
    const decided = agg.outcomeMatched + agg.outcomeUnmatched;
    return {
      ...agg,
      hitRate: clampHitRate(agg.outcomeMatched, decided),
      decidedCount: decided,
    };
  };

  const typeBreakdown = {};
  for (const [type, agg] of Object.entries(byType)) {
    typeBreakdown[type] = decorateHitRate(agg);
  }

  return {
    overall: decorateHitRate(allAgg),
    byType: typeBreakdown,
    windowMonths: Number.isFinite(opts.windowMonths) ? opts.windowMonths : null,
  };
}

// Tiny helper: given a period count in months, returns the cutoff
// Date (UTC) that audit rows must have resolvedAt >= to be included.
// Exposed so route handlers and tests share the same boundary math.
function cutoffForWindow(monthsBack, now = new Date()) {
  const m = Number.isFinite(monthsBack) && monthsBack > 0 ? Math.floor(monthsBack) : 6;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
  return d;
}

module.exports = {
  computeAccuracy,
  cutoffForWindow,
  clampHitRate,
  isResolvedWithOutcome,
  VALID_RESOLUTIONS,
};
