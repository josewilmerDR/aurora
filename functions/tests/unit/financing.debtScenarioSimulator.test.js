// Unit tests for the debt scenario simulator wrapper. Pure — no Firestore.

const {
  simulateDebtRoi,
  buildWithoutDebtContext,
  buildWithDebtContext,
  computeScenarioDelta,
  computeResumenDelta,
} = require('../../lib/financing/debtScenarioSimulator');

function baselineForTest(overrides = {}) {
  return {
    baselineMonthlyRevenue: 20000,
    baselineMonthlyCost: 15000,
    initialCash: 30000,
    commitmentsByMonth: new Array(12).fill(0),
    priceVolatility: 0.10,
    yieldVolatility: 0.08,
    costDriftMonthly: 0.005,
    ...overrides,
  };
}

// ─── buildWithoutDebtContext ─────────────────────────────────────────────

describe('buildWithoutDebtContext', () => {
  test('normalizes commitments array to horizonteMeses', () => {
    const ctx = buildWithoutDebtContext({
      baseline: baselineForTest({ commitmentsByMonth: [100, 200] }),
      horizonteMeses: 12,
    });
    expect(ctx.commitmentsByMonth).toHaveLength(12);
    expect(ctx.commitmentsByMonth[0]).toBe(100);
    expect(ctx.commitmentsByMonth[1]).toBe(200);
    expect(ctx.commitmentsByMonth.slice(2).every(v => v === 0)).toBe(true);
  });
});

// ─── buildWithDebtContext ────────────────────────────────────────────────

describe('buildWithDebtContext', () => {
  const baseline = baselineForTest({ initialCash: 30000 });

  test('month-0 disbursement → initialCash += amount', () => {
    const ctx = buildWithDebtContext({
      baseline,
      debtCashFlow: {
        disbursementByMonth: [10000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        paymentsByMonth: new Array(12).fill(0),
      },
      useCaseImpact: { extraRevenueByMonth: [], extraCostByMonth: [] },
      horizonteMeses: 12,
    });
    expect(ctx.initialCash).toBe(40000);
  });

  test('payments added to commitments, NOT to initialCash', () => {
    const ctx = buildWithDebtContext({
      baseline,
      debtCashFlow: {
        disbursementByMonth: new Array(12).fill(0),
        paymentsByMonth: [500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500],
      },
      useCaseImpact: { extraRevenueByMonth: [], extraCostByMonth: [] },
      horizonteMeses: 12,
    });
    expect(ctx.commitmentsByMonth).toEqual(new Array(12).fill(500));
    expect(ctx.initialCash).toBe(30000);
  });

  test('useCase revenue boost reduces commitments (negative)', () => {
    const ctx = buildWithDebtContext({
      baseline: baselineForTest({ commitmentsByMonth: new Array(12).fill(100) }),
      debtCashFlow: {
        disbursementByMonth: new Array(12).fill(0),
        paymentsByMonth: new Array(12).fill(0),
      },
      useCaseImpact: {
        extraRevenueByMonth: [0, 0, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500],
        extraCostByMonth: [],
      },
      horizonteMeses: 12,
    });
    // commitments[0..1] = 100; commitments[2..11] = 100 - 500 = -400
    expect(ctx.commitmentsByMonth[0]).toBe(100);
    expect(ctx.commitmentsByMonth[2]).toBe(-400);
  });

  test('cost reduction (negative extraCost) also reduces commitments', () => {
    const ctx = buildWithDebtContext({
      baseline: baselineForTest({ commitmentsByMonth: new Array(12).fill(0) }),
      debtCashFlow: {
        disbursementByMonth: new Array(12).fill(0),
        paymentsByMonth: new Array(12).fill(0),
      },
      useCaseImpact: {
        extraRevenueByMonth: [],
        extraCostByMonth: new Array(12).fill(-200),
      },
      horizonteMeses: 12,
    });
    expect(ctx.commitmentsByMonth).toEqual(new Array(12).fill(-200));
  });
});

// ─── computeScenarioDelta ────────────────────────────────────────────────

describe('computeScenarioDelta', () => {
  function fakeScenarios(marginMap) {
    return ['Pesimista', 'Base', 'Optimista'].map(name => ({
      name,
      margenProyectado: marginMap[name],
      percentiles: { cajaFinal: { p10: 0, p50: marginMap[name] * 0.5, p90: marginMap[name] } },
    }));
  }

  test('computes margin + cash delta per scenario', () => {
    const without = fakeScenarios({ Pesimista: 100, Base: 200, Optimista: 300 });
    const withS = fakeScenarios({ Pesimista: 80, Base: 250, Optimista: 320 });
    const out = computeScenarioDelta(without, withS);
    expect(out.Pesimista.margen.delta).toBe(-20);
    expect(out.Base.margen.delta).toBe(50);
    expect(out.Optimista.margen.delta).toBe(20);
  });
});

describe('computeResumenDelta', () => {
  test('subtracts without from with', () => {
    const out = computeResumenDelta(
      { margenMedio: 100, cajaFinalMedia: 1000 },
      { margenMedio: 150, cajaFinalMedia: 900 }
    );
    expect(out.margenMedio.delta).toBe(50);
    expect(out.cajaFinalMedia.delta).toBe(-100);
  });
});

// ─── simulateDebtRoi integration ─────────────────────────────────────────

describe('simulateDebtRoi', () => {
  const debt = { amount: 10000, plazoMeses: 12, apr: 0.12, esquemaAmortizacion: 'cuota_fija' };

  test('deterministic: same seed → identical output', () => {
    const inputs = { baseline: baselineForTest(), debt, useCase: null, seed: 42, nTrials: 200 };
    const a = simulateDebtRoi(inputs);
    const b = simulateDebtRoi(inputs);
    expect(a.withDebt.resumen).toEqual(b.withDebt.resumen);
    expect(a.delta.resumen).toEqual(b.delta.resumen);
  });

  test('returns both legs + delta + warnings array', () => {
    const out = simulateDebtRoi({
      baseline: baselineForTest(),
      debt,
      useCase: null,
      seed: 1,
      nTrials: 100,
    });
    expect(out.withoutDebt.scenarios).toHaveLength(3);
    expect(out.withDebt.scenarios).toHaveLength(3);
    expect(out.delta.byScenario.Base).toBeTruthy();
    expect(Array.isArray(out.warnings)).toBe(true);
  });

  test('warns when loan term > horizon', () => {
    const out = simulateDebtRoi({
      baseline: baselineForTest(),
      debt: { ...debt, plazoMeses: 24 },
      useCase: null,
      seed: 1,
      nTrials: 50,
    });
    expect(out.warnings.some(w => w.startsWith('TRUNCATED_AT_HORIZON'))).toBe(true);
  });

  test('error propagates from debt cash flow builder', () => {
    const out = simulateDebtRoi({
      baseline: baselineForTest(),
      debt: { amount: -1, plazoMeses: 12, apr: 0.1, esquemaAmortizacion: 'cuota_fija' },
      seed: 1,
    });
    expect(out.error).toBeDefined();
  });

  test('useCase revenue boost improves margin delta', () => {
    const noBoost = simulateDebtRoi({
      baseline: baselineForTest(),
      debt,
      useCase: null,
      seed: 7,
      nTrials: 200,
    });
    const withBoost = simulateDebtRoi({
      baseline: baselineForTest(),
      debt,
      useCase: {
        tipo: 'siembra',
        expectedReturnModel: { kind: 'linear', monthlyIncrease: 2000, startMonth: 0 },
      },
      seed: 7,
      nTrials: 200,
    });
    expect(withBoost.delta.resumen.margenMedio.delta).toBeGreaterThan(
      noBoost.delta.resumen.margenMedio.delta
    );
  });
});
