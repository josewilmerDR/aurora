// Workload projector — pure.
//
// Projects upcoming labor demand by walking active siembras against
// their packages' activities[]. For each activity in the horizon, we
// compute its date (siembra.fecha + activity.day) and bucket it into
// the ISO-week it lands in.
//
// Known limitation: packages.activities[] have NO per-activity hour
// field. The projector therefore emits two metrics side-by-side:
//
//   - totalActivities  (hard, data-backed count)
//   - estimatedPersonHours (SOFT, uses a per-activity default)
//
// Both are present in every weekly bucket. The soft metric is there
// so downstream consumers can feed `demandedWorkers` without each one
// re-inventing a default. The default lives in opts.defaultActivityHours
// (fallback: 4h) and should be surfaced in the UI so users know what
// they're looking at.

const { DEFAULT_FALLBACK_WEEKLY_HOURS } = require('./capacityCalculator');

const MS_PER_DAY = 24 * 3_600_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const DEFAULT_ACTIVITY_HOURS = 4;
const MIN_HORIZON_WEEKS = 1;
const MAX_HORIZON_WEEKS = 26;

function toMillis(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

// Monday-based week start (UTC). Matches the treasury convention in
// lib/finance/weekRanges.js — keep consistent so the UI can align
// HR and finance charts on the same week boundaries.
function startOfWeekUTC(dateMs) {
  const d = new Date(dateMs);
  const dow = d.getUTCDay();
  const daysSinceMonday = (dow + 6) % 7; // 0=Mon, 6=Sun
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function clampHorizon(n) {
  if (!Number.isFinite(Number(n))) return 12;
  const v = Math.floor(Number(n));
  if (v < MIN_HORIZON_WEEKS) return MIN_HORIZON_WEEKS;
  if (v > MAX_HORIZON_WEEKS) return MAX_HORIZON_WEEKS;
  return v;
}

function projectWorkload(input = {}) {
  const {
    siembras = [],
    packages = [],
    horizonWeeks,
    now = new Date(),
    opts = {},
  } = input;

  const horizon = clampHorizon(horizonWeeks);
  const defaultActivityHours = Number.isFinite(opts.defaultActivityHours)
    ? Math.max(0, opts.defaultActivityHours)
    : DEFAULT_ACTIVITY_HOURS;
  const avgWeeklyHoursPerWorker = Number.isFinite(opts.avgWeeklyHoursPerWorker) && opts.avgWeeklyHoursPerWorker > 0
    ? opts.avgWeeklyHoursPerWorker
    : DEFAULT_FALLBACK_WEEKLY_HOURS;

  const packageIndex = new Map();
  for (const pkg of packages) {
    if (!pkg || !pkg.id) continue;
    packageIndex.set(pkg.id, pkg);
  }

  const nowMs = toMillis(now) ?? Date.now();
  const firstWeekStart = startOfWeekUTC(nowMs);
  const windowEndMs = firstWeekStart + horizon * MS_PER_WEEK;

  // Pre-seed weeks so the output always spans the full horizon, even
  // when nothing is scheduled — a flat 0-activity chart is useful info.
  const weeks = [];
  for (let i = 0; i < horizon; i++) {
    const weekStartMs = firstWeekStart + i * MS_PER_WEEK;
    weeks.push({
      weekStart: isoDate(weekStartMs),
      weekEnd: isoDate(weekStartMs + MS_PER_WEEK - MS_PER_DAY),
      totalActivities: 0,
      estimatedPersonHours: 0,
      byLabor: {},
      demandedWorkers: 0,
    });
  }

  let droppedNoPackage = 0;
  let droppedClosed = 0;
  let droppedNoDate = 0;
  let droppedOutOfWindow = 0;
  let totalActivitiesScheduled = 0;

  for (const siembra of siembras) {
    if (!siembra) continue;
    if (siembra.cerrado === true) { droppedClosed += 1; continue; }
    const siembraDateMs = toMillis(siembra.fecha);
    if (siembraDateMs == null) { droppedNoDate += 1; continue; }
    const pkgId = siembra.packageId || siembra.paqueteId;
    if (!pkgId) { droppedNoPackage += 1; continue; }
    const pkg = packageIndex.get(pkgId);
    if (!pkg || !Array.isArray(pkg.activities)) { droppedNoPackage += 1; continue; }

    for (const act of pkg.activities) {
      if (!act || typeof act.name !== 'string') continue;
      const offsetDays = Number(act.day);
      if (!Number.isFinite(offsetDays)) continue;
      const activityDateMs = siembraDateMs + offsetDays * MS_PER_DAY;
      if (activityDateMs < firstWeekStart || activityDateMs >= windowEndMs) {
        droppedOutOfWindow += 1;
        continue;
      }
      const weekIndex = Math.floor((activityDateMs - firstWeekStart) / MS_PER_WEEK);
      const bucket = weeks[weekIndex];
      if (!bucket) continue;
      bucket.totalActivities += 1;
      bucket.estimatedPersonHours += defaultActivityHours;
      bucket.byLabor[act.name] = (bucket.byLabor[act.name] || 0) + 1;
      totalActivitiesScheduled += 1;
    }
  }

  // Reshape byLabor from map → sorted array and compute demandedWorkers.
  for (const w of weeks) {
    w.byLabor = Object.entries(w.byLabor)
      .map(([labor, count]) => ({ labor, count }))
      .sort((a, b) => b.count - a.count || a.labor.localeCompare(b.labor));
    w.estimatedPersonHours = Math.round(w.estimatedPersonHours * 10) / 10;
    w.demandedWorkers = avgWeeklyHoursPerWorker > 0
      ? Math.ceil(w.estimatedPersonHours / avgWeeklyHoursPerWorker)
      : 0;
  }

  return {
    horizonWeeks: horizon,
    now: isoDate(nowMs),
    assumptions: {
      defaultActivityHours,
      avgWeeklyHoursPerWorker,
    },
    weeks,
    summary: {
      totalActivitiesScheduled,
      estimatedPersonHoursTotal: weeks.reduce((s, w) => s + w.estimatedPersonHours, 0),
    },
    diagnostics: {
      droppedNoPackage,
      droppedClosed,
      droppedNoDate,
      droppedOutOfWindow,
      siembrasConsidered: siembras.length,
      packagesKnown: packageIndex.size,
    },
  };
}

module.exports = {
  projectWorkload,
  startOfWeekUTC,
  DEFAULT_ACTIVITY_HOURS,
  MIN_HORIZON_WEEKS,
  MAX_HORIZON_WEEKS,
};
