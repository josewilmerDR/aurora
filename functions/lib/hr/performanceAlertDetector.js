// Performance alert detector — pure.
//
// Scans monthly score history across workers and emits alerts when
// someone has sustained below-peer performance. Output feeds
// sugerir_revision_desempeno actions.
//
// Rules (phase 3 plan):
//   - 2 consecutive months < p25 of peers in the same period  → 'media'
//   - 3 consecutive months < p10 (lower decile)              → 'alta'
//   - If `lowConfidence: true` in ANY relevant month          → SKIP
//
// The skip-on-low-confidence rule is non-negotiable. A new worker
// with 2 or 3 tasks in a month can randomly land in the lower decile
// for reasons that have nothing to do with them. We don't put
// statistical noise in front of a supervisor as "someone to review".

const DEFAULT_OPTS = Object.freeze({
  consecutiveMonthsForMedia: 2,
  consecutiveMonthsForAlta: 3,
  // Percentile thresholds. Using the current definitions from the
  // phase 3 plan. If research later shows these over/under-trigger,
  // override via opts rather than edit constants here.
  p25Threshold: 25,
  lowerDecileThreshold: 10,
});

// Linear-interpolation percentile on a sorted ascending numeric array.
function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const pct = Math.max(0, Math.min(100, p));
  const rank = (pct / 100) * (sortedValues.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedValues[lo];
  const weight = rank - lo;
  return sortedValues[lo] * (1 - weight) + sortedValues[hi] * weight;
}

// Given scores for one period, computes the cutoffs the detector
// will apply. Workers with lowConfidence=true are excluded from the
// percentile inputs — we don't want noisy scores skewing the cutoff
// for everyone else.
function computePeriodCutoffs(periodScores, opts) {
  const reliable = (periodScores || []).filter(s => s && !s.lowConfidence && Number.isFinite(s.score));
  if (reliable.length < 3) {
    // Not enough reliable workers to compute peer percentiles
    return { p25: null, p10: null, reliableCount: reliable.length };
  }
  const sorted = reliable.map(s => s.score).sort((a, b) => a - b);
  return {
    p25: percentile(sorted, opts.p25Threshold),
    p10: percentile(sorted, opts.lowerDecileThreshold),
    reliableCount: reliable.length,
  };
}

// Indexes `scoresByPeriod` into a Map for O(1) lookup by (userId, period).
function indexScores(scoresByPeriod) {
  const index = new Map();
  for (const [period, scores] of Object.entries(scoresByPeriod || {})) {
    const byUser = new Map();
    for (const s of scores || []) {
      if (s && s.userId) byUser.set(s.userId, s);
    }
    index.set(period, byUser);
  }
  return index;
}

// Walk the period chain newest → oldest checking if the worker stays
// below a given cutoff. Returns the run length ending at the current
// period (0 if the current period doesn't qualify).
function consecutiveRunBelow({ userId, periodChain, scoreIndex, cutoffs, threshold }) {
  let run = 0;
  for (const period of periodChain) {
    const periodScores = scoreIndex.get(period);
    const cutoff = cutoffs.get(period)?.[threshold];
    if (cutoff == null) return run; // can't evaluate older periods
    const entry = periodScores?.get(userId);
    if (!entry) return run;
    if (entry.lowConfidence) return run; // any low-confidence breaks the run
    if (!Number.isFinite(entry.score)) return run;
    if (entry.score < cutoff) {
      run += 1;
    } else {
      return run;
    }
  }
  return run;
}

function detectAlerts(input = {}) {
  const {
    currentPeriod,
    periodChain, // newest → oldest, including currentPeriod as index 0
    scoresByPeriod = {},
    opts = {},
  } = input;

  if (!currentPeriod || !Array.isArray(periodChain) || periodChain.length === 0) {
    return { alerts: [], reason: 'missing_inputs' };
  }
  if (periodChain[0] !== currentPeriod) {
    return { alerts: [], reason: 'periodChain_must_lead_with_currentPeriod' };
  }

  const cfg = { ...DEFAULT_OPTS, ...opts };
  const scoreIndex = indexScores(scoresByPeriod);

  // Precompute cutoffs per period.
  const cutoffs = new Map();
  for (const period of periodChain) {
    const scores = scoresByPeriod[period] || [];
    cutoffs.set(period, computePeriodCutoffs(scores, cfg));
  }

  const currentScores = scoresByPeriod[currentPeriod] || [];
  const alerts = [];

  for (const entry of currentScores) {
    if (!entry || !entry.userId) continue;
    if (entry.lowConfidence) continue;
    if (!Number.isFinite(entry.score)) continue;

    const p25Cutoff = cutoffs.get(currentPeriod)?.p25;
    const p10Cutoff = cutoffs.get(currentPeriod)?.p10;
    if (p25Cutoff == null) continue; // not enough peer data this period

    // Check alta first (stricter); if it qualifies, we still emit a
    // single alert with severity='alta'.
    let severity = null;
    let evidencePeriods = [];

    const altaRun = consecutiveRunBelow({
      userId: entry.userId, periodChain, scoreIndex, cutoffs, threshold: 'p10',
    });
    if (altaRun >= cfg.consecutiveMonthsForAlta) {
      severity = 'alta';
      evidencePeriods = periodChain.slice(0, altaRun);
    } else {
      const mediaRun = consecutiveRunBelow({
        userId: entry.userId, periodChain, scoreIndex, cutoffs, threshold: 'p25',
      });
      if (mediaRun >= cfg.consecutiveMonthsForMedia) {
        severity = 'media';
        evidencePeriods = periodChain.slice(0, mediaRun);
      }
    }

    if (!severity) continue;

    alerts.push({
      userId: entry.userId,
      severity,
      reason: severity === 'alta'
        ? `Bajo decil inferior ${evidencePeriods.length} meses consecutivos.`
        : `Bajo p25 ${evidencePeriods.length} meses consecutivos.`,
      evidenceRefs: {
        periods: evidencePeriods,
        scores: evidencePeriods.map(p => scoreIndex.get(p)?.get(entry.userId)?.score ?? null),
        cutoffsUsed: evidencePeriods.map(p => ({
          period: p,
          p25: cutoffs.get(p)?.p25 ?? null,
          p10: cutoffs.get(p)?.p10 ?? null,
          reliableCount: cutoffs.get(p)?.reliableCount ?? 0,
        })),
      },
    });
  }

  return { alerts, reason: alerts.length > 0 ? 'alerts_detected' : 'no_alerts' };
}

module.exports = {
  detectAlerts,
  percentile,
  computePeriodCutoffs,
  consecutiveRunBelow,
  indexScores,
  DEFAULT_OPTS,
};
