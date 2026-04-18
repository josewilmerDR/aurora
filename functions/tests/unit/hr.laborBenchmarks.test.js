// Unit tests for laborBenchmarks. Pure.

const {
  computeLaborBenchmarks,
  classifyAgainstBenchmark,
  percentile,
  DEFAULT_MIN_SAMPLES_FOR_BENCHMARK,
} = require('../../lib/hr/laborBenchmarks');

describe('percentile', () => {
  test('empty input returns null', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile(null, 50)).toBeNull();
  });

  test('single value returns that value at any percentile', () => {
    expect(percentile([42], 25)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  test('textbook example: [1..9]', () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(percentile(vals, 50)).toBe(5);
    expect(percentile(vals, 25)).toBe(3);
    expect(percentile(vals, 75)).toBe(7);
  });

  test('linear interpolation between ranks', () => {
    // [10, 20] at p50 sits between them → 15
    expect(percentile([10, 20], 50)).toBe(15);
    expect(percentile([10, 20], 25)).toBe(12.5);
  });

  test('clamps out-of-range percentiles to [0, 100]', () => {
    const vals = [1, 2, 3, 4, 5];
    expect(percentile(vals, -10)).toBe(1);
    expect(percentile(vals, 200)).toBe(5);
  });
});

describe('computeLaborBenchmarks', () => {
  test('empty input returns empty array', () => {
    expect(computeLaborBenchmarks([])).toEqual([]);
    expect(computeLaborBenchmarks(null)).toEqual([]);
  });

  test('DEFAULT_MIN_SAMPLES_FOR_BENCHMARK is 3', () => {
    expect(DEFAULT_MIN_SAMPLES_FOR_BENCHMARK).toBe(3);
  });

  test('drops labor+unidad buckets below minSamplesForBenchmark workers', () => {
    const rows = [
      { userId: 'u1', labor: 'Deshierva', unidad: 'planta', avgCantidad: 100 },
      { userId: 'u2', labor: 'Deshierva', unidad: 'planta', avgCantidad: 120 },
    ];
    // 2 workers < default 3 → empty
    expect(computeLaborBenchmarks(rows)).toEqual([]);
  });

  test('emits benchmark when enough distinct workers', () => {
    const rows = [
      { userId: 'u1', labor: 'Deshierva', unidad: 'planta', avgCantidad: 100 },
      { userId: 'u2', labor: 'Deshierva', unidad: 'planta', avgCantidad: 200 },
      { userId: 'u3', labor: 'Deshierva', unidad: 'planta', avgCantidad: 300 },
      { userId: 'u4', labor: 'Deshierva', unidad: 'planta', avgCantidad: 400 },
      { userId: 'u5', labor: 'Deshierva', unidad: 'planta', avgCantidad: 500 },
    ];
    const out = computeLaborBenchmarks(rows);
    expect(out).toHaveLength(1);
    const b = out[0];
    expect(b.labor).toBe('Deshierva');
    expect(b.unidad).toBe('planta');
    expect(b.n).toBe(5);
    expect(b.p25).toBe(200);
    expect(b.p50).toBe(300);
    expect(b.p75).toBe(400);
    expect(b.min).toBe(100);
    expect(b.max).toBe(500);
  });

  test('buckets separately by unidad (never cross-compare units)', () => {
    const rows = [];
    for (const u of ['u1', 'u2', 'u3']) {
      rows.push({ userId: u, labor: 'Deshierva', unidad: 'planta', avgCantidad: 100 });
      rows.push({ userId: u, labor: 'Deshierva', unidad: 'hectarea', avgCantidad: 2 });
    }
    const out = computeLaborBenchmarks(rows);
    expect(out).toHaveLength(2);
    const byUnidad = Object.fromEntries(out.map(o => [o.unidad, o]));
    expect(byUnidad.planta.p50).toBe(100);
    expect(byUnidad.hectarea.p50).toBe(2);
  });

  test('counts distinct workers, not observations', () => {
    // 2 distinct users with multiple rows each = 2 workers < threshold
    const rows = [
      { userId: 'u1', labor: 'Deshierva', unidad: 'planta', avgCantidad: 100 },
      { userId: 'u1', labor: 'Deshierva', unidad: 'planta', avgCantidad: 150 },
      { userId: 'u2', labor: 'Deshierva', unidad: 'planta', avgCantidad: 200 },
    ];
    expect(computeLaborBenchmarks(rows)).toEqual([]);
  });

  test('custom minSamplesForBenchmark=1 lets single-worker buckets through', () => {
    const rows = [
      { userId: 'u1', labor: 'Deshierva', unidad: 'planta', avgCantidad: 100 },
    ];
    const out = computeLaborBenchmarks(rows, { minSamplesForBenchmark: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].p25).toBe(100);
    expect(out[0].p75).toBe(100);
  });

  test('ignores rows missing avgCantidad', () => {
    const rows = [
      { userId: 'u1', labor: 'X', unidad: 'p', avgCantidad: null },
      { userId: 'u2', labor: 'X', unidad: 'p' },
      { userId: 'u3', labor: 'X', unidad: 'p', avgCantidad: NaN },
    ];
    expect(computeLaborBenchmarks(rows)).toEqual([]);
  });
});

describe('classifyAgainstBenchmark', () => {
  const bench = { p25: 100, p50: 200, p75: 300 };

  test('below_p25 when strictly less', () => {
    expect(classifyAgainstBenchmark(50, bench)).toBe('below_p25');
  });

  test('above_p75 when strictly greater', () => {
    expect(classifyAgainstBenchmark(400, bench)).toBe('above_p75');
  });

  test('in_range when between p25 and p75 inclusive', () => {
    expect(classifyAgainstBenchmark(100, bench)).toBe('in_range');
    expect(classifyAgainstBenchmark(200, bench)).toBe('in_range');
    expect(classifyAgainstBenchmark(300, bench)).toBe('in_range');
  });

  test('unknown on null/undefined inputs', () => {
    expect(classifyAgainstBenchmark(null, bench)).toBe('unknown');
    expect(classifyAgainstBenchmark(100, null)).toBe('unknown');
    expect(classifyAgainstBenchmark(NaN, bench)).toBe('unknown');
  });
});
