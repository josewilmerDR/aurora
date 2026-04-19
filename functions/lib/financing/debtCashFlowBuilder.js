// Pure builder of the debt cash flow series over a simulation horizon.
//
// Given the credit terms (amount + plazo + apr + esquema) this produces two
// arrays of length `horizonteMeses`:
//
//   - disbursementByMonth[m]: inflow received at month m (usually amount at
//     month 0, zero elsewhere).
//   - paymentsByMonth[m]: outflow paid at month m.
//
// Convention — "pay at beginning of period":
//   Month 0 = disbursement + first payment on the same month. Payment k lands
//   at horizon index `disbursementMonth + k - 1`. Payments beyond the horizon
//   are dropped and flagged via `truncated` + `remainingBalanceAtHorizon` so
//   the caller can warn the user that not all liability is captured in the
//   simulation window.

const { simulateCost } = require('./creditCostCalculator');

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function buildDebtCashFlow({
  amount,
  plazoMeses,
  apr,
  esquema,
  horizonteMeses = 12,
  disbursementMonth = 0,
}) {
  const H = Number(horizonteMeses);
  if (!Number.isInteger(H) || H < 1 || H > 60) {
    return { error: 'horizonteMeses must be integer in [1, 60].' };
  }
  const dm = Number(disbursementMonth);
  if (!Number.isInteger(dm) || dm < 0 || dm >= H) {
    return { error: `disbursementMonth must be integer in [0, ${H - 1}].` };
  }

  const sim = simulateCost({ amount, plazoMeses, apr, esquema });
  if (sim.error) return { error: sim.error };

  const disbursementByMonth = new Array(H).fill(0);
  const paymentsByMonth = new Array(H).fill(0);

  disbursementByMonth[dm] = round2(Number(amount));

  // Payment k (1-indexed) lands at horizon index disbursementMonth + k - 1.
  // "Pay at beginning of period" convention — see file-level note.
  let truncatedCount = 0;
  let lastCapturedIdx = -1;
  for (let k = 1; k <= sim.schedule.length; k += 1) {
    const horizonIdx = dm + k - 1;
    if (horizonIdx >= H) {
      truncatedCount += 1;
      continue;
    }
    paymentsByMonth[horizonIdx] += sim.schedule[k - 1].payment;
    lastCapturedIdx = k - 1;
  }

  const truncated = truncatedCount > 0;
  const remainingBalanceAtHorizon = truncated && lastCapturedIdx >= 0
    ? round2(sim.schedule[lastCapturedIdx].remainingBalance)
    : 0;

  return {
    disbursementByMonth,
    paymentsByMonth: paymentsByMonth.map(round2),
    schedule: sim.schedule,
    totalInterest: sim.totals.totalInterest,
    totalPayment: sim.totals.totalPayment,
    monthlyPayment: sim.schedule[0]?.payment ?? 0,
    truncated,
    truncatedMonthsCount: truncatedCount,
    remainingBalanceAtHorizon,
  };
}

// ─── useCase expected-return model ────────────────────────────────────────

// Translates the caller's abstract useCase model into two month-indexed
// arrays (length horizonteMeses): extra revenue and extra cost that the
// debt is supposed to produce.
//
// Supported `kind`:
//   - 'linear'           — constant monthlyIncrease from startMonth on.
//   - 'delayed_revenue'  — lump new revenue starts at startMonth.
//   - 'cost_reduction'   — constant monthlyCostReduction from startMonth on.
//   - 'none' / missing   — zero arrays.
//
// Deliberately deterministic: Monte Carlo noise lives on the BASELINE
// revenue/cost. The useCase return is a conservative point estimate the user
// supplies. They can tune it down for safety margin.
function applyUseCaseToMonths(useCase, horizonteMeses) {
  const H = Number(horizonteMeses) || 0;
  const extraRevenueByMonth = new Array(H).fill(0);
  const extraCostByMonth = new Array(H).fill(0);
  const model = useCase && typeof useCase === 'object' ? useCase.expectedReturnModel : null;
  if (!model || !model.kind || model.kind === 'none') {
    return { extraRevenueByMonth, extraCostByMonth };
  }

  const startMonth = Math.max(0, Number(model.startMonth) || 0);

  if (model.kind === 'linear' || model.kind === 'delayed_revenue') {
    const inc = Number(model.monthlyIncrease) || 0;
    for (let m = startMonth; m < H; m += 1) {
      extraRevenueByMonth[m] = round2(inc);
    }
  } else if (model.kind === 'cost_reduction') {
    const red = Number(model.monthlyCostReduction) || 0;
    for (let m = startMonth; m < H; m += 1) {
      // Stored as negative extraCost (reduction). The scenario simulator
      // adds this to commitments; negative commitment = lower outflow.
      extraCostByMonth[m] = round2(-red);
    }
  }

  return { extraRevenueByMonth, extraCostByMonth };
}

module.exports = {
  buildDebtCashFlow,
  applyUseCaseToMonths,
};
