// Unit tests for the eligibility matcher. Pure — no Firestore, no Claude.

const {
  summarizeSnapshot,
  evaluateProduct,
  rankProducts,
  THRESHOLDS,
  _internals: {
    checkAmountFit,
    checkCashFloor,
    checkProjectedLiquidity,
    checkEquityCoverage,
    checkRevenueScale,
    weightedScore,
    classifyRecommendation,
    collectManualChecks,
    extractMinRevenue,
  },
} = require('../../lib/financing/eligibilityMatcher');

function baseSnapshot(overrides = {}) {
  return {
    balanceSheet: {
      equity: { totalEquity: 200000 },
      assets: {
        totalAssets: 250000,
        cash: { amount: 50000 },
      },
    },
    incomeStatement: {
      revenue: { amount: 120000 },
    },
    cashFlow: {
      history: {
        series: new Array(12).fill({}),
        summary: { totalInflows: 180000, totalOutflows: 120000 },
      },
      projection: {
        summary: { minBalance: 15000 },
      },
    },
    ...overrides,
  };
}

function baseProduct(overrides = {}) {
  return {
    id: 'P1',
    providerName: 'Banco X',
    tipo: 'agricola',
    esquemaAmortizacion: 'cuota_fija',
    monedaMin: 5000,
    monedaMax: 100000,
    plazoMesesMin: 6,
    plazoMesesMax: 24,
    aprMin: 0.10,
    aprMax: 0.18,
    requisitos: [],
    activo: true,
    ...overrides,
  };
}

// ─── summarizeSnapshot ────────────────────────────────────────────────────

describe('summarizeSnapshot', () => {
  test('extracts canonical fields with rounding', () => {
    const s = summarizeSnapshot(baseSnapshot());
    expect(s.totalEquity).toBe(200000);
    expect(s.annualRevenue).toBe(120000);
    expect(s.avgMonthlyInflow).toBe(15000);
    expect(s.avgMonthlyNet).toBe(5000);
    expect(s.minProjectedBalance).toBe(15000);
  });

  test('returns zeros on empty snapshot', () => {
    const s = summarizeSnapshot({});
    expect(s.totalEquity).toBe(0);
    expect(s.avgMonthlyInflow).toBe(0);
    expect(s.avgMonthlyNet).toBe(0);
  });
});

// ─── Individual checks ────────────────────────────────────────────────────

describe('checkAmountFit', () => {
  test('pass when in range', () => {
    expect(checkAmountFit(baseProduct(), 50000).passed).toBe(true);
  });
  test('fail below min', () => {
    expect(checkAmountFit(baseProduct(), 1000).passed).toBe(false);
  });
  test('fail above max', () => {
    expect(checkAmountFit(baseProduct(), 200000).passed).toBe(false);
  });
});

describe('checkCashFloor', () => {
  test('score 1 when ratio ≤ GOOD', () => {
    const out = checkCashFloor({ monthlyPayment: 300, avgMonthlyNet: 5000 });
    expect(out.score).toBe(1);
    expect(out.passed).toBe(true);
  });

  test('score 0 when ratio ≥ BAD', () => {
    const out = checkCashFloor({ monthlyPayment: 3000, avgMonthlyNet: 5000 });
    expect(out.score).toBe(0);
    expect(out.passed).toBe(false);
  });

  test('interpolates in the middle band', () => {
    const out = checkCashFloor({ monthlyPayment: 2000, avgMonthlyNet: 5000 }); // 40%
    expect(out.score).toBeGreaterThan(0);
    expect(out.score).toBeLessThan(1);
  });

  test('fails when net inflow ≤ 0', () => {
    const out = checkCashFloor({ monthlyPayment: 100, avgMonthlyNet: 0 });
    expect(out.score).toBe(0);
    expect(out.passed).toBe(false);
  });
});

describe('checkProjectedLiquidity', () => {
  test('pass with headroom ≥ payment', () => {
    const out = checkProjectedLiquidity({ monthlyPayment: 1000, minProjectedBalance: 5000 });
    expect(out.score).toBe(1);
  });
  test('fail when min balance below payment', () => {
    const out = checkProjectedLiquidity({ monthlyPayment: 1000, minProjectedBalance: 500 });
    expect(out.score).toBe(0);
  });
  test('scales linearly when headroom is tight', () => {
    // headroom = 500, payment 1000 → ratio 0.5
    const out = checkProjectedLiquidity({ monthlyPayment: 1000, minProjectedBalance: 1500 });
    expect(out.score).toBe(0.5);
  });
});

describe('checkEquityCoverage', () => {
  test('not applicable without collateral requisito', () => {
    const out = checkEquityCoverage({
      product: baseProduct(), targetAmount: 10000, totalEquity: 5000,
    });
    expect(out.applicable).toBe(false);
    expect(out.score).toBe(1);
  });

  test('applicable when product requires garantia_hipotecaria', () => {
    const product = baseProduct({
      requisitos: [{ tipo: 'garantia', codigo: 'garantia_hipotecaria', descripcion: 'Hipoteca sobre propiedad' }],
    });
    const pass = checkEquityCoverage({ product, targetAmount: 50000, totalEquity: 100000 });
    expect(pass.applicable).toBe(true);
    expect(pass.score).toBe(1); // 2x coverage

    const fail = checkEquityCoverage({ product, targetAmount: 100000, totalEquity: 50000 });
    expect(fail.applicable).toBe(true);
    expect(fail.score).toBe(0); // 0.5x coverage
  });
});

describe('checkRevenueScale', () => {
  test('not applicable without metrica requisito', () => {
    const out = checkRevenueScale({ product: baseProduct(), annualRevenue: 1000 });
    expect(out.applicable).toBe(false);
  });

  test('pass when revenue meets min', () => {
    const product = baseProduct({
      requisitos: [{ tipo: 'metrica', codigo: 'min_revenue_12m', descripcion: '50000 USD anuales' }],
    });
    const out = checkRevenueScale({ product, annualRevenue: 60000 });
    expect(out.applicable).toBe(true);
    expect(out.score).toBe(1);
  });

  test('fails hard when far below min', () => {
    const product = baseProduct({
      requisitos: [{ tipo: 'metrica', codigo: 'min_revenue_12m', descripcion: '100000 USD' }],
    });
    const out = checkRevenueScale({ product, annualRevenue: 30000 });
    expect(out.score).toBe(0);
  });
});

// ─── extractMinRevenue ────────────────────────────────────────────────────

describe('extractMinRevenue', () => {
  test('parses plain number', () => {
    expect(extractMinRevenue({ descripcion: '50000 USD' })).toBe(50000);
  });
  test('parses with comma thousands', () => {
    expect(extractMinRevenue({ descripcion: '1,500,000 colones' })).toBe(1500000);
  });
  test('returns null when no number', () => {
    expect(extractMinRevenue({ descripcion: 'Sin mínimo' })).toBeNull();
  });
});

// ─── Aggregate helpers ────────────────────────────────────────────────────

describe('weightedScore', () => {
  test('applicable checks dominate; N/A checks skipped', () => {
    const checks = [
      { name: 'cash_floor', applicable: true, score: 1 },
      { name: 'projected_liquidity', applicable: true, score: 0 },
      { name: 'equity_coverage', applicable: false, score: 1 },
      { name: 'revenue_scale', applicable: false, score: 1 },
    ];
    // cash_floor=0.35, projected=0.30 → (0.35*1 + 0.30*0) / (0.35+0.30) = 0.35/0.65 ≈ 0.538
    const s = weightedScore(checks);
    expect(s).toBeCloseTo(0.538, 2);
  });

  test('returns 0 when no applicable checks', () => {
    expect(weightedScore([{ applicable: false, score: 1 }])).toBe(0);
  });
});

describe('classifyRecommendation', () => {
  test('bucketing', () => {
    expect(classifyRecommendation(0.9)).toBe('elegible');
    expect(classifyRecommendation(THRESHOLDS.SCORE_ELIGIBLE)).toBe('elegible');
    expect(classifyRecommendation(0.6)).toBe('revisar');
    expect(classifyRecommendation(THRESHOLDS.SCORE_BORDERLINE)).toBe('revisar');
    expect(classifyRecommendation(0.4)).toBe('no_elegible');
  });
});

describe('collectManualChecks', () => {
  test('returns only documento-type requisitos', () => {
    const product = baseProduct({
      requisitos: [
        { tipo: 'documento', codigo: 'rut', descripcion: 'Cédula jurídica' },
        { tipo: 'garantia', codigo: 'aval', descripcion: 'Aval personal' },
        { tipo: 'documento', codigo: 'estados', descripcion: 'Estados financieros 2 años' },
      ],
    });
    const out = collectManualChecks(product);
    expect(out).toHaveLength(2);
    expect(out[0].codigo).toBe('rut');
    expect(out[1].codigo).toBe('estados');
  });
});

// ─── evaluateProduct integration ──────────────────────────────────────────

describe('evaluateProduct', () => {
  const summary = summarizeSnapshot(baseSnapshot());

  test('strong finca + generous product → elegible', () => {
    const result = evaluateProduct({
      summary, product: baseProduct(), targetAmount: 10000, targetUse: 'insumos',
    });
    expect(result.amountFit.passed).toBe(true);
    expect(result.suggestedTerm).toBeTruthy();
    expect(result.score).toBeGreaterThan(THRESHOLDS.SCORE_ELIGIBLE);
    expect(result.recommendation).toBe('elegible');
  });

  test('amount outside envelope → score 0, no_elegible', () => {
    const result = evaluateProduct({
      summary, product: baseProduct({ monedaMax: 5000 }), targetAmount: 50000, targetUse: 'insumos',
    });
    expect(result.score).toBe(0);
    expect(result.recommendation).toBe('no_elegible');
    expect(result.suggestedTerm).toBeNull();
  });

  test('weak cash flow pushes toward no_elegible', () => {
    const weakSnapshot = baseSnapshot({
      cashFlow: {
        history: {
          series: new Array(12).fill({}),
          summary: { totalInflows: 60000, totalOutflows: 55000 }, // avg net ≈ 417/mo
        },
        projection: { summary: { minBalance: 500 } },
      },
    });
    const result = evaluateProduct({
      summary: summarizeSnapshot(weakSnapshot),
      product: baseProduct(),
      targetAmount: 50000,
      targetUse: 'siembra',
    });
    expect(result.score).toBeLessThan(THRESHOLDS.SCORE_ELIGIBLE);
  });

  test('surfaces documento requisitos as manualChecks', () => {
    const product = baseProduct({
      requisitos: [{ tipo: 'documento', codigo: 'rut', descripcion: 'Cédula jurídica' }],
    });
    const result = evaluateProduct({
      summary, product, targetAmount: 10000, targetUse: 'insumos',
    });
    expect(result.manualChecks).toEqual([{ codigo: 'rut', descripcion: 'Cédula jurídica' }]);
  });
});

// ─── rankProducts ─────────────────────────────────────────────────────────

describe('rankProducts', () => {
  const summary = summarizeSnapshot(baseSnapshot());

  test('sorts by score descending', () => {
    const tight = baseProduct({ id: 'PA', monedaMax: 10000 });
    const generous = baseProduct({ id: 'PB' });
    const results = rankProducts({
      summary,
      products: [tight, generous],
      targetAmount: 50000,
      targetUse: 'insumos',
    });
    // Tight product rejects (amount out of range, score 0); generous passes.
    expect(results[0].productId).toBe('PB');
    expect(results[1].productId).toBe('PA');
  });

  test('filters out inactive products', () => {
    const results = rankProducts({
      summary,
      products: [baseProduct({ id: 'active' }), baseProduct({ id: 'inactive', activo: false })],
      targetAmount: 10000,
      targetUse: 'insumos',
    });
    expect(results.map(r => r.productId)).toEqual(['active']);
  });

  test('minScore trims low scorers', () => {
    const tight = baseProduct({ id: 'PA', monedaMax: 1000 }); // will score 0
    const results = rankProducts({
      summary, products: [tight], targetAmount: 50000, targetUse: 'insumos', minScore: 0.5,
    });
    expect(results).toEqual([]);
  });
});
