// Pure eligibility matcher. Given a financial profile snapshot and a credit
// product catalog, evaluates each product against the finca's financial
// reality and emits a score (0-1) + deterministic breakdown + recommendation.
//
// Design choices:
//
//   - Amount fit is a HARD filter. If the request falls outside the product's
//     [monedaMin, monedaMax] envelope, the product is eliminated (score 0).
//
//   - Worst-case simulation: for cash-flow checks we use the product's
//     aprMax and plazoMesesMax to compute the monthly payment. This is the
//     most conservative assumption — the real payment will be lower.
//
//   - Soft checks (cash floor, projected liquidity, equity, revenue scale)
//     each emit a 0-1 subscore. The overall score is a weighted average.
//
//   - `tipo: 'documento'` requisitos can't be verified automatically; we
//     surface them as `manualChecks` the user must confirm. They don't
//     affect the score.
//
// No Firestore here. Caller passes the snapshot + product list in.

const { simulateCost } = require('./creditCostCalculator');

// Thresholds — exported so tests can assert the policy is stable.
const THRESHOLDS = Object.freeze({
  // Payment-to-income ratio: fully OK up to 30% of monthly net inflow, linear
  // penalty to 50%, hard fail beyond.
  CASH_FLOOR_GOOD: 0.30,
  CASH_FLOOR_BAD: 0.50,
  // Projected cash headroom multiplier: accept when min balance - monthly
  // payment stays above this fraction of the payment itself.
  LIQUIDITY_HEADROOM_MULT: 1.0,
  // Equity / request: for products that require `garantia_hipotecaria` the
  // patrimonio must be at least this multiple of the requested amount.
  EQUITY_COVERAGE_FULL: 1.5,
  EQUITY_COVERAGE_PARTIAL: 1.0,
  // Revenue scale: requisitos can declare `min_revenue_12m`. The check
  // passes when annual revenue meets or exceeds the threshold.
  REVENUE_SCALE_PARTIAL: 0.7,
  // Score buckets → recommendation.
  SCORE_ELIGIBLE: 0.75,
  SCORE_BORDERLINE: 0.50,
});

const SOFT_CHECK_WEIGHTS = Object.freeze({
  cash_floor: 0.35,
  projected_liquidity: 0.30,
  equity_coverage: 0.20,
  revenue_scale: 0.15,
});

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─── Snapshot summary ─────────────────────────────────────────────────────

// Extracts the numbers each check needs from a snapshot. Keeping this tight
// so changes to the snapshot shape have a single adapter to update.
function summarizeSnapshot(snapshot) {
  const bs = snapshot?.balanceSheet || {};
  const is = snapshot?.incomeStatement || {};
  const cf = snapshot?.cashFlow || {};

  const historyMonths = Array.isArray(cf.history?.series) ? cf.history.series.length : 0;
  const totalInflows = Number(cf.history?.summary?.totalInflows) || 0;
  const totalOutflows = Number(cf.history?.summary?.totalOutflows) || 0;
  const avgMonthlyInflow = historyMonths > 0 ? totalInflows / historyMonths : 0;
  const avgMonthlyNet = historyMonths > 0 ? (totalInflows - totalOutflows) / historyMonths : 0;

  return {
    totalEquity: Number(bs.equity?.totalEquity) || 0,
    totalAssets: Number(bs.assets?.totalAssets) || 0,
    cashAmount: Number(bs.assets?.cash?.amount) || 0,
    annualRevenue: Number(is.revenue?.amount) || 0,
    avgMonthlyInflow: round2(avgMonthlyInflow),
    avgMonthlyNet: round2(avgMonthlyNet),
    minProjectedBalance: Number(cf.projection?.summary?.minBalance) || 0,
  };
}

// ─── Individual checks ────────────────────────────────────────────────────

function checkAmountFit(product, targetAmount) {
  const min = Number(product.monedaMin) || 0;
  const max = Number(product.monedaMax) || 0;
  const amt = Number(targetAmount) || 0;
  if (amt < min || amt > max) {
    return {
      passed: false,
      detail: `Monto ${amt} fuera del rango del producto [${min}, ${max}].`,
    };
  }
  return {
    passed: true,
    detail: `Monto ${amt} dentro del rango [${min}, ${max}].`,
  };
}

// Worst-case monthly payment: uses the product's max APR and max term so the
// estimate is conservative. Returns null if simulation errors out.
function estimateWorstCasePayment(product, targetAmount) {
  const result = simulateCost({
    amount: Number(targetAmount),
    plazoMeses: Number(product.plazoMesesMax),
    apr: Number(product.aprMax),
    esquema: product.esquemaAmortizacion,
  });
  if (result.error) return null;
  // Representative monthly payment: use the first month (bullet scheme has
  // near-zero first-month principal but interest dominates anyway).
  const firstRow = result.schedule?.[0];
  if (!firstRow) return null;
  return {
    monthlyPayment: firstRow.payment,
    plazoMeses: result.inputs.plazoMeses,
    apr: result.inputs.apr,
  };
}

function checkCashFloor({ monthlyPayment, avgMonthlyNet }) {
  if (avgMonthlyNet <= 0) {
    return {
      score: 0,
      passed: false,
      detail: `Flujo neto mensual promedio ≤ 0; no hay capacidad de pago demostrable.`,
    };
  }
  const ratio = monthlyPayment / avgMonthlyNet;
  const { CASH_FLOOR_GOOD, CASH_FLOOR_BAD } = THRESHOLDS;
  if (ratio <= CASH_FLOOR_GOOD) {
    return {
      score: 1,
      passed: true,
      detail: `Cuota/neto ${(ratio * 100).toFixed(1)}% ≤ ${CASH_FLOOR_GOOD * 100}%.`,
    };
  }
  if (ratio >= CASH_FLOOR_BAD) {
    return {
      score: 0,
      passed: false,
      detail: `Cuota/neto ${(ratio * 100).toFixed(1)}% ≥ ${CASH_FLOOR_BAD * 100}%.`,
    };
  }
  // Linear interpolation between GOOD and BAD.
  const score = (CASH_FLOOR_BAD - ratio) / (CASH_FLOOR_BAD - CASH_FLOOR_GOOD);
  return {
    score: clamp01(score),
    passed: score >= 0.5,
    detail: `Cuota/neto ${(ratio * 100).toFixed(1)}% en zona intermedia.`,
  };
}

function checkProjectedLiquidity({ monthlyPayment, minProjectedBalance }) {
  const headroom = minProjectedBalance - monthlyPayment;
  if (headroom < 0) {
    return {
      score: 0,
      passed: false,
      detail: `Saldo mínimo proyectado (${minProjectedBalance}) no cubre la cuota (${monthlyPayment}).`,
    };
  }
  const headroomRatio = monthlyPayment > 0 ? headroom / monthlyPayment : Infinity;
  if (headroomRatio >= THRESHOLDS.LIQUIDITY_HEADROOM_MULT) {
    return {
      score: 1,
      passed: true,
      detail: `Saldo mínimo proyectado cubre la cuota con margen (${headroomRatio.toFixed(2)}× la cuota).`,
    };
  }
  return {
    score: clamp01(headroomRatio),
    passed: headroomRatio >= 0.5,
    detail: `Saldo mínimo proyectado justo cubre la cuota (${headroomRatio.toFixed(2)}× la cuota).`,
  };
}

function checkEquityCoverage({ product, targetAmount, totalEquity }) {
  // Only applies when the product requires real-asset collateral.
  const requiresCollateral = (product.requisitos || []).some(
    r => r.tipo === 'garantia' && /hipotecaria|real/i.test(r.codigo || '')
  );
  if (!requiresCollateral) {
    return {
      applicable: false,
      score: 1, // neutral
      passed: true,
      detail: 'Producto no exige garantía real; cobertura de patrimonio no aplica.',
    };
  }
  if (targetAmount <= 0) {
    return { applicable: true, score: 0, passed: false, detail: 'Monto inválido.' };
  }
  const ratio = totalEquity / targetAmount;
  if (ratio >= THRESHOLDS.EQUITY_COVERAGE_FULL) {
    return {
      applicable: true, score: 1, passed: true,
      detail: `Patrimonio cubre ${ratio.toFixed(2)}× el monto (≥ ${THRESHOLDS.EQUITY_COVERAGE_FULL}×).`,
    };
  }
  if (ratio <= THRESHOLDS.EQUITY_COVERAGE_PARTIAL) {
    return {
      applicable: true, score: 0, passed: false,
      detail: `Patrimonio solo cubre ${ratio.toFixed(2)}× el monto (< ${THRESHOLDS.EQUITY_COVERAGE_PARTIAL}×).`,
    };
  }
  const score = (ratio - THRESHOLDS.EQUITY_COVERAGE_PARTIAL)
    / (THRESHOLDS.EQUITY_COVERAGE_FULL - THRESHOLDS.EQUITY_COVERAGE_PARTIAL);
  return {
    applicable: true,
    score: clamp01(score),
    passed: score >= 0.5,
    detail: `Patrimonio cubre ${ratio.toFixed(2)}× el monto (parcial).`,
  };
}

// Parses a metrica requisito like { codigo: 'min_revenue_12m', descripcion: '50000 USD' }
// The minimum is encoded in `codigo` suffix or `descripcion` numeric prefix.
function extractMinRevenue(requisito) {
  const desc = typeof requisito.descripcion === 'string' ? requisito.descripcion : '';
  const m = desc.match(/^\s*([\d.,]+)/);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function checkRevenueScale({ product, annualRevenue }) {
  const req = (product.requisitos || []).find(
    r => r.tipo === 'metrica' && /min_revenue/i.test(r.codigo || '')
  );
  if (!req) {
    return {
      applicable: false,
      score: 1,
      passed: true,
      detail: 'Producto no exige revenue mínimo; criterio no aplica.',
    };
  }
  const min = extractMinRevenue(req);
  if (min === null) {
    return {
      applicable: true,
      score: 0.5,
      passed: false,
      detail: `Requisito de revenue presente pero no parseable: "${req.descripcion}".`,
    };
  }
  if (annualRevenue >= min) {
    return {
      applicable: true,
      score: 1,
      passed: true,
      detail: `Revenue 12m (${annualRevenue}) ≥ mínimo (${min}).`,
    };
  }
  const ratio = annualRevenue / min;
  if (ratio >= THRESHOLDS.REVENUE_SCALE_PARTIAL) {
    return {
      applicable: true,
      score: clamp01(ratio),
      passed: false,
      detail: `Revenue 12m (${annualRevenue}) al ${(ratio * 100).toFixed(0)}% del mínimo (${min}).`,
    };
  }
  return {
    applicable: true,
    score: 0,
    passed: false,
    detail: `Revenue 12m (${annualRevenue}) muy por debajo del mínimo (${min}).`,
  };
}

// ─── Aggregate ────────────────────────────────────────────────────────────

function weightedScore(softChecks) {
  let numer = 0;
  let denom = 0;
  for (const c of softChecks) {
    if (!c || c.applicable === false) continue;
    const w = SOFT_CHECK_WEIGHTS[c.name] || 0;
    numer += (c.score || 0) * w;
    denom += w;
  }
  if (denom === 0) return 0;
  return numer / denom;
}

function classifyRecommendation(score) {
  if (score >= THRESHOLDS.SCORE_ELIGIBLE) return 'elegible';
  if (score >= THRESHOLDS.SCORE_BORDERLINE) return 'revisar';
  return 'no_elegible';
}

function collectManualChecks(product) {
  const reqs = Array.isArray(product.requisitos) ? product.requisitos : [];
  return reqs
    .filter(r => r.tipo === 'documento')
    .map(r => ({ codigo: r.codigo, descripcion: r.descripcion }));
}

function evaluateProduct({ summary, product, targetAmount, targetUse }) {
  const productId = product.id || null;
  const amountFit = checkAmountFit(product, targetAmount);
  if (!amountFit.passed) {
    return {
      productId,
      providerName: product.providerName || null,
      tipo: product.tipo || null,
      targetUse: typeof targetUse === 'string' ? targetUse : null,
      amountFit,
      suggestedTerm: null,
      softChecks: [],
      manualChecks: collectManualChecks(product),
      score: 0,
      recommendation: 'no_elegible',
      reason: 'Monto fuera del envelope del producto.',
    };
  }

  const payment = estimateWorstCasePayment(product, targetAmount);
  if (!payment) {
    return {
      productId,
      providerName: product.providerName || null,
      tipo: product.tipo || null,
      targetUse: typeof targetUse === 'string' ? targetUse : null,
      amountFit,
      suggestedTerm: null,
      softChecks: [],
      manualChecks: collectManualChecks(product),
      score: 0,
      recommendation: 'no_elegible',
      reason: 'No se pudo simular la cuota mensual.',
    };
  }

  const cashFloor = {
    name: 'cash_floor',
    ...checkCashFloor({ monthlyPayment: payment.monthlyPayment, avgMonthlyNet: summary.avgMonthlyNet }),
  };
  const projectedLiquidity = {
    name: 'projected_liquidity',
    ...checkProjectedLiquidity({ monthlyPayment: payment.monthlyPayment, minProjectedBalance: summary.minProjectedBalance }),
  };
  const equityCoverage = {
    name: 'equity_coverage',
    ...checkEquityCoverage({ product, targetAmount, totalEquity: summary.totalEquity }),
  };
  const revenueScale = {
    name: 'revenue_scale',
    ...checkRevenueScale({ product, annualRevenue: summary.annualRevenue }),
  };

  const softChecks = [cashFloor, projectedLiquidity, equityCoverage, revenueScale];
  const score = round2(weightedScore(softChecks));
  const recommendation = classifyRecommendation(score);

  return {
    productId,
    providerName: product.providerName || null,
    tipo: product.tipo || null,
    targetUse: typeof targetUse === 'string' ? targetUse : null,
    amountFit,
    suggestedTerm: {
      plazoMeses: payment.plazoMeses,
      apr: payment.apr,
      monthlyPayment: payment.monthlyPayment,
    },
    softChecks,
    manualChecks: collectManualChecks(product),
    score,
    recommendation,
  };
}

function rankProducts({ summary, products, targetAmount, targetUse, minScore = 0 }) {
  const results = (products || [])
    .filter(p => p && p.activo !== false)
    .map(p => evaluateProduct({ summary, product: p, targetAmount, targetUse }));
  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  return results.filter(r => (r.score || 0) >= minScore);
}

module.exports = {
  summarizeSnapshot,
  evaluateProduct,
  rankProducts,
  THRESHOLDS,
  SOFT_CHECK_WEIGHTS,
  // exported for tests
  _internals: {
    checkAmountFit,
    checkCashFloor,
    checkProjectedLiquidity,
    checkEquityCoverage,
    checkRevenueScale,
    weightedScore,
    classifyRecommendation,
    collectManualChecks,
    estimateWorstCasePayment,
    extractMinRevenue,
  },
};
