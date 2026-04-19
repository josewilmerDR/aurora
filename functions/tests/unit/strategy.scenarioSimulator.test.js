// Unit tests for scenarioSimulator. Pure — no Firestore.

const {
  simulateScenarios,
  _runTrial,
  _bucketTrials,
  _percentile,
  SCENARIO_NAMES,
  DEFAULTS,
} = require('../../lib/strategy/scenarioSimulator');
const { createPrng } = require('../../lib/strategy/prng');

describe('_percentile', () => {
  test('handles empty array', () => {
    expect(_percentile([], 0.5)).toBe(0);
  });
  test('boundary quantiles', () => {
    expect(_percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(_percentile([1, 2, 3, 4, 5], 1)).toBe(5);
  });
  test('interpolates between values', () => {
    expect(_percentile([0, 10], 0.5)).toBe(5);
    expect(_percentile([10, 20, 30, 40], 0.5)).toBe(25);
  });
});

describe('_runTrial', () => {
  test('deterministic output with fixed seed', () => {
    const ctx = {
      baselineMonthlyRevenue: 10000,
      baselineMonthlyCost: 7000,
      initialCash: 50000,
      commitmentsByMonth: new Array(12).fill(500),
      priceVolatility: 0.1,
      yieldVolatility: 0.05,
      costDriftMonthly: 0.005,
      horizonteMeses: 12,
    };
    const a = _runTrial(ctx, createPrng(1));
    const b = _runTrial(ctx, createPrng(1));
    expect(a.cumRevenue).toBeCloseTo(b.cumRevenue, 6);
    expect(a.finalCash).toBeCloseTo(b.finalCash, 6);
  });

  test('returns 12 months of cash when horizon is 12', () => {
    const ctx = {
      baselineMonthlyRevenue: 1000, baselineMonthlyCost: 500, initialCash: 0,
      commitmentsByMonth: new Array(12).fill(0), priceVolatility: 0,
      yieldVolatility: 0, costDriftMonthly: 0, horizonteMeses: 12,
    };
    const trial = _runTrial(ctx, createPrng(1));
    expect(trial.cashByMonth).toHaveLength(12);
  });

  test('with zero volatility, trial reduces to deterministic monthly sum', () => {
    const ctx = {
      baselineMonthlyRevenue: 1000, baselineMonthlyCost: 400,
      initialCash: 100, commitmentsByMonth: new Array(12).fill(0),
      priceVolatility: 0, yieldVolatility: 0, costDriftMonthly: 0,
      horizonteMeses: 12,
    };
    const trial = _runTrial(ctx, createPrng(1));
    // Sin drift, sin volatilidad: 12 * 1000 ingreso, 12 * 400 costo
    expect(trial.cumRevenue).toBeCloseTo(12000, 2);
    expect(trial.cumCost).toBeCloseTo(4800, 2);
    expect(trial.margen).toBeCloseTo(7200, 2);
    expect(trial.finalCash).toBeCloseTo(100 + 7200, 2);
  });

  test('cost drift compounds month over month', () => {
    const ctx = {
      baselineMonthlyRevenue: 0, baselineMonthlyCost: 1000,
      initialCash: 0, commitmentsByMonth: new Array(12).fill(0),
      priceVolatility: 0, yieldVolatility: 0, costDriftMonthly: 0.01,
      horizonteMeses: 12,
    };
    const trial = _runTrial(ctx, createPrng(1));
    // Sum of 1000 * 1.01^0 + 1000 * 1.01^1 + ... + 1000 * 1.01^11
    // ≈ 12682.5
    expect(trial.cumCost).toBeGreaterThan(12_000);
    expect(trial.cumCost).toBeLessThan(13_000);
  });

  test('commitments subtract from cash', () => {
    const ctx = {
      baselineMonthlyRevenue: 0, baselineMonthlyCost: 0,
      initialCash: 1000, commitmentsByMonth: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      priceVolatility: 0, yieldVolatility: 0, costDriftMonthly: 0,
      horizonteMeses: 12,
    };
    const trial = _runTrial(ctx, createPrng(1));
    expect(trial.finalCash).toBeCloseTo(1000 - 1200, 2);
  });
});

describe('_bucketTrials', () => {
  test('sums to total; buckets follow quartiles', () => {
    const trials = Array.from({ length: 100 }, (_, i) => ({
      margen: i,
      cumRevenue: 0, cumCost: 0, finalCash: 0,
      cashByMonth: new Array(12).fill(0),
    }));
    const { pesimista, base, optimista } = _bucketTrials(trials);
    expect(pesimista.length + base.length + optimista.length).toBe(100);
    expect(pesimista.length).toBe(25);
    expect(optimista.length).toBe(25);
  });

  test('pesimista has lowest margenes; optimista has highest', () => {
    const trials = Array.from({ length: 20 }, (_, i) => ({
      margen: i,
      cumRevenue: 0, cumCost: 0, finalCash: 0,
      cashByMonth: new Array(12).fill(0),
    }));
    const { pesimista, optimista } = _bucketTrials(trials);
    const maxP = Math.max(...pesimista.map(t => t.margen));
    const minO = Math.min(...optimista.map(t => t.margen));
    expect(maxP).toBeLessThan(minO);
  });
});

describe('simulateScenarios — smoke', () => {
  const baseCtx = {
    baselineMonthlyRevenue: 10_000,
    baselineMonthlyCost: 7_000,
    initialCash: 50_000,
    commitmentsByMonth: new Array(12).fill(0),
    priceVolatility: 0.15,
    yieldVolatility: 0.1,
    costDriftMonthly: 0.005,
    horizonteMeses: 12,
  };

  test('returns 3 named scenarios', () => {
    const out = simulateScenarios(baseCtx, { nTrials: 200, seed: 7 });
    expect(out.scenarios.map(s => s.name)).toEqual(SCENARIO_NAMES);
    expect(out.scenarios).toHaveLength(3);
  });

  test('probabilidades sum approximately to 1', () => {
    const out = simulateScenarios(baseCtx, { nTrials: 200, seed: 7 });
    const total = out.scenarios.reduce((s, sc) => s + sc.probabilidad, 0);
    expect(total).toBeCloseTo(1.0, 2);
  });

  test('pesimista.margen < base.margen < optimista.margen (by design)', () => {
    const out = simulateScenarios(baseCtx, { nTrials: 500, seed: 13 });
    const [p, b, o] = out.scenarios;
    expect(p.margenProyectado).toBeLessThan(b.margenProyectado);
    expect(b.margenProyectado).toBeLessThan(o.margenProyectado);
  });

  test('same seed produces identical output', () => {
    const a = simulateScenarios(baseCtx, { nTrials: 100, seed: 42 });
    const b = simulateScenarios(baseCtx, { nTrials: 100, seed: 42 });
    expect(a.resumen.margenMedio).toBe(b.resumen.margenMedio);
    expect(a.scenarios.map(s => s.margenProyectado)).toEqual(b.scenarios.map(s => s.margenProyectado));
  });

  test('different seeds produce different resumen', () => {
    const a = simulateScenarios(baseCtx, { nTrials: 100, seed: 1 });
    const b = simulateScenarios(baseCtx, { nTrials: 100, seed: 2 });
    expect(a.resumen.margenMedio).not.toBe(b.resumen.margenMedio);
  });

  test('zero volatility collapses scenarios to essentially the same value', () => {
    const out = simulateScenarios({ ...baseCtx, priceVolatility: 0, yieldVolatility: 0 }, { nTrials: 100, seed: 1 });
    const margens = out.scenarios.map(s => s.margenProyectado);
    // Todas deberían ser prácticamente iguales.
    expect(Math.abs(margens[0] - margens[2])).toBeLessThan(1);
  });

  test('nTrials clamped to [10, 5000]', () => {
    const lo = simulateScenarios(baseCtx, { nTrials: 0, seed: 1 });
    expect(lo.nTrials).toBe(10);
    const hi = simulateScenarios(baseCtx, { nTrials: 1_000_000, seed: 1 });
    expect(hi.nTrials).toBe(5000);
  });

  test('each scenario reports 12 monthly cash projections', () => {
    const out = simulateScenarios(baseCtx, { nTrials: 100, seed: 1 });
    for (const s of out.scenarios) {
      expect(s.proyeccionCaja).toHaveLength(12);
    }
  });

  test('percentiles have p10 <= p50 <= p90', () => {
    const out = simulateScenarios(baseCtx, { nTrials: 200, seed: 1 });
    for (const s of out.scenarios) {
      expect(s.percentiles.margen.p10).toBeLessThanOrEqual(s.percentiles.margen.p50);
      expect(s.percentiles.margen.p50).toBeLessThanOrEqual(s.percentiles.margen.p90);
    }
  });
});

describe('DEFAULTS', () => {
  test('are immutable', () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
  });
});
