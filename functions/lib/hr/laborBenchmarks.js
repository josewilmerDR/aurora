// Labor benchmarks — pure.
//
// Given a productivity matrix, compute percentiles (p25/p50/p75) per
// (labor, unidad) bucket. Benchmarks let a supervisor see where a
// worker falls relative to peers *on the same labor*. Never across.
//
// A separate bucket per `unidad` is enforced here too: a "Deshierva
// por planta" benchmark is meaningless for "Deshierva por hectárea"
// even though both share the labor name.

const DEFAULT_MIN_SAMPLES_FOR_BENCHMARK = 3;

// Linear interpolation percentile. Standard textbook definition
// (inclusive endpoints). Input must be a non-empty sorted ascending
// array of numbers.
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

function benchmarkKey(labor, unidad) {
  return `${labor}|||${unidad || ''}`;
}

// rows: output of productivityMatrix. opts.minSamplesForBenchmark
// controls how many distinct workers must contribute before a bucket
// gets a benchmark. Default 3 matches the matrix per-pair threshold —
// any bucket that survives matrix filtering *can* get a benchmark, but
// with only 1-2 workers, percentiles are not informative.
function computeLaborBenchmarks(rows, opts = {}) {
  const minSamples = Number.isFinite(opts.minSamplesForBenchmark)
    ? Math.max(1, Math.floor(opts.minSamplesForBenchmark))
    : DEFAULT_MIN_SAMPLES_FOR_BENCHMARK;

  const buckets = new Map();
  for (const r of rows || []) {
    if (!r || typeof r.labor !== 'string') continue;
    if (!Number.isFinite(r.avgCantidad)) continue;
    const key = benchmarkKey(r.labor, r.unidad);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { labor: r.labor, unidad: r.unidad || null, values: [], workers: new Set() };
      buckets.set(key, bucket);
    }
    bucket.values.push(r.avgCantidad);
    bucket.workers.add(r.userId);
  }

  const out = [];
  for (const b of buckets.values()) {
    if (b.workers.size < minSamples) continue;
    const sorted = b.values.slice().sort((a, b) => a - b);
    out.push({
      labor: b.labor,
      unidad: b.unidad,
      n: b.workers.size,
      p25: round2(percentile(sorted, 25)),
      p50: round2(percentile(sorted, 50)),
      p75: round2(percentile(sorted, 75)),
      min: round2(sorted[0]),
      max: round2(sorted[sorted.length - 1]),
    });
  }
  out.sort((a, b) => {
    if (a.labor !== b.labor) return a.labor.localeCompare(b.labor);
    return (a.unidad || '').localeCompare(b.unidad || '');
  });
  return out;
}

function round2(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

// Given a (labor, unidad, avgCantidad), classify where a worker sits
// vs the benchmarks. Used by downstream consumers (3.5 alerts, UI
// heatmap) that want a single-word signal. Never compares across
// (labor, unidad) boundaries.
function classifyAgainstBenchmark(avgCantidad, benchmark) {
  if (!benchmark || avgCantidad == null || !Number.isFinite(avgCantidad)) return 'unknown';
  if (avgCantidad < benchmark.p25) return 'below_p25';
  if (avgCantidad > benchmark.p75) return 'above_p75';
  return 'in_range';
}

module.exports = {
  computeLaborBenchmarks,
  classifyAgainstBenchmark,
  DEFAULT_MIN_SAMPLES_FOR_BENCHMARK,
  // Exposed for tests
  percentile,
  benchmarkKey,
};
