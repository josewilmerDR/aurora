// Pure wrapper over strategy/scenarioSimulator.js for Fase 5.4.
//
// Runs TWO Monte Carlo simulations back to back — one with the debt cash
// flow layered onto the baseline, one without — using the same seed so the
// random draws per trial are identical across both runs. The per-scenario
// percentile delta (Pesimista/Base/Optimista × p10/p50/p90) is then a fair
// comparison of "what would happen if I took this loan" vs the counterfactual.
//
// Both the debt cash flow and the useCase expected-return model are treated
// as DETERMINISTIC additions: the MC noise still applies to the baseline
// production, but the debt payments and the useCase returns are fixed per
// month. Rationale: the user supplies a conservative point estimate of their
// return; we don't layer probability on top of another probability.

const { simulateScenarios, SCENARIO_NAMES } = require('../strategy/scenarioSimulator');
const { buildDebtCashFlow, applyUseCaseToMonths } = require('./debtCashFlowBuilder');

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function padToHorizon(arr, H) {
  const out = Array.isArray(arr) ? arr.slice(0, H) : [];
  while (out.length < H) out.push(0);
  return out.map(v => Number(v) || 0);
}

// ─── Context adjuster ────────────────────────────────────────────────────

// Builds the `withDebtContext` by layering:
//   - disbursement onto initialCash (lump inflow on disbursement month)
//   - monthly payments onto commitmentsByMonth (positive outflow)
//   - useCase expected returns onto commitmentsByMonth (negative = inflow)
//
// Exposed for tests so the layering logic can be verified without running
// the full MC.
function buildWithDebtContext({
  baseline,
  debtCashFlow,
  useCaseImpact,
  horizonteMeses,
}) {
  const H = Number(horizonteMeses) || 12;
  const commitmentsBase = padToHorizon(baseline.commitmentsByMonth || [], H);
  const disbursements = padToHorizon(debtCashFlow.disbursementByMonth || [], H);
  const payments = padToHorizon(debtCashFlow.paymentsByMonth || [], H);
  const revBoost = padToHorizon(useCaseImpact?.extraRevenueByMonth || [], H);
  const costDelta = padToHorizon(useCaseImpact?.extraCostByMonth || [], H);

  const commitments = new Array(H);
  for (let m = 0; m < H; m += 1) {
    // Start with baseline commitments.
    let c = commitmentsBase[m];
    // Debt payment in month m = outflow.
    c += payments[m];
    // Disbursement in month m ≠ 0 still counts as inflow through this
    // channel (the "initialCash + amount" path only covers month-0
    // disbursements). Encoded as negative commitment.
    if (m > 0) c -= disbursements[m];
    // useCase revenue boost = negative commitment (raises cash).
    c -= revBoost[m];
    // useCase cost delta: extraCost already signed — `cost_reduction` is
    // negative, direct pass-through.
    c += costDelta[m];
    commitments[m] = round2(c);
  }

  // Month-0 disbursement is added to initialCash for numerical cleanliness:
  // the simulator never sees a one-time spike in "commitments" that makes
  // percentile interpretation harder.
  const initialCashAdjusted = Number(baseline.initialCash || 0) + Number(disbursements[0] || 0);

  return {
    baselineMonthlyRevenue: Number(baseline.baselineMonthlyRevenue) || 0,
    baselineMonthlyCost: Number(baseline.baselineMonthlyCost) || 0,
    initialCash: round2(initialCashAdjusted),
    commitmentsByMonth: commitments,
    priceVolatility: Number(baseline.priceVolatility ?? 0.15),
    yieldVolatility: Number(baseline.yieldVolatility ?? 0.10),
    costDriftMonthly: Number(baseline.costDriftMonthly ?? 0.005),
    horizonteMeses: H,
  };
}

function buildWithoutDebtContext({ baseline, horizonteMeses }) {
  const H = Number(horizonteMeses) || 12;
  return {
    baselineMonthlyRevenue: Number(baseline.baselineMonthlyRevenue) || 0,
    baselineMonthlyCost: Number(baseline.baselineMonthlyCost) || 0,
    initialCash: Number(baseline.initialCash) || 0,
    commitmentsByMonth: padToHorizon(baseline.commitmentsByMonth || [], H),
    priceVolatility: Number(baseline.priceVolatility ?? 0.15),
    yieldVolatility: Number(baseline.yieldVolatility ?? 0.10),
    costDriftMonthly: Number(baseline.costDriftMonthly ?? 0.005),
    horizonteMeses: H,
  };
}

// ─── Deltas ────────────────────────────────────────────────────────────────

// Per-scenario delta between the two simulations. Computed from each run's
// already-bucketed percentiles — not per-trial pairing, because the
// scenarioSimulator doesn't expose trial-level data externally.
function computeScenarioDelta(withoutS, withS) {
  const result = {};
  for (const name of SCENARIO_NAMES) {
    const a = withoutS.find(s => s.name === name);
    const b = withS.find(s => s.name === name);
    if (!a || !b) continue;
    result[name] = {
      margen: {
        without: a.margenProyectado,
        withDebt: b.margenProyectado,
        delta: round2(b.margenProyectado - a.margenProyectado),
      },
      cajaFinal: {
        without: a.percentiles.cajaFinal.p50,
        withDebt: b.percentiles.cajaFinal.p50,
        delta: round2(b.percentiles.cajaFinal.p50 - a.percentiles.cajaFinal.p50),
      },
    };
  }
  return result;
}

function computeResumenDelta(withoutR, withR) {
  return {
    margenMedio: {
      without: withoutR.margenMedio,
      withDebt: withR.margenMedio,
      delta: round2(withR.margenMedio - withoutR.margenMedio),
    },
    cajaFinalMedia: {
      without: withoutR.cajaFinalMedia,
      withDebt: withR.cajaFinalMedia,
      delta: round2(withR.cajaFinalMedia - withoutR.cajaFinalMedia),
    },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

function simulateDebtRoi({
  baseline,
  debt,
  useCase,
  horizonteMeses = 12,
  nTrials = 500,
  seed = 1,
}) {
  if (!baseline || typeof baseline !== 'object') return { error: 'baseline is required.' };
  if (!debt || typeof debt !== 'object') return { error: 'debt is required.' };

  const debtCashFlow = buildDebtCashFlow({
    amount: debt.amount,
    plazoMeses: debt.plazoMeses,
    apr: debt.apr,
    esquema: debt.esquemaAmortizacion || debt.esquema,
    horizonteMeses,
    disbursementMonth: debt.disbursementMonth || 0,
  });
  if (debtCashFlow.error) return { error: debtCashFlow.error };

  const useCaseImpact = applyUseCaseToMonths(useCase, horizonteMeses);

  const withoutDebtContext = buildWithoutDebtContext({ baseline, horizonteMeses });
  const withDebtContext = buildWithDebtContext({
    baseline, debtCashFlow, useCaseImpact, horizonteMeses,
  });

  const withoutDebt = simulateScenarios(withoutDebtContext, { nTrials, seed });
  const withDebt = simulateScenarios(withDebtContext, { nTrials, seed });

  const scenarioDelta = computeScenarioDelta(withoutDebt.scenarios, withDebt.scenarios);
  const resumenDelta = computeResumenDelta(withoutDebt.resumen, withDebt.resumen);

  const warnings = [];
  if (debtCashFlow.truncated) {
    warnings.push(
      `TRUNCATED_AT_HORIZON:${debtCashFlow.truncatedMonthsCount}:balance=${debtCashFlow.remainingBalanceAtHorizon}`
    );
  }
  // Flag extra risk if adding the debt causes negative median cash in the
  // pessimistic scenario when it wasn't negative without debt.
  const pessWithout = withoutDebt.scenarios.find(s => s.name === 'Pesimista');
  const pessWith = withDebt.scenarios.find(s => s.name === 'Pesimista');
  if (pessWithout && pessWith
      && pessWithout.percentiles.cajaFinal.p50 >= 0
      && pessWith.percentiles.cajaFinal.p50 < 0) {
    warnings.push('DEBT_CAUSES_NEGATIVE_CASH_IN_PESSIMISTIC');
  }

  return {
    withoutDebt,
    withDebt,
    delta: {
      byScenario: scenarioDelta,
      resumen: resumenDelta,
    },
    debtCashFlow,
    useCaseImpact,
    warnings,
    seed,
    nTrials,
    horizonteMeses,
  };
}

module.exports = {
  simulateDebtRoi,
  buildWithoutDebtContext,
  buildWithDebtContext,
  computeScenarioDelta,
  computeResumenDelta,
};
