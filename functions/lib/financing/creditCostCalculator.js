// Pure amortization math for the three schemes a credit_product can declare:
//   - cuota_fija             (French / PMT — constant payment)
//   - amortizacion_constante (German — constant principal)
//   - bullet                 (interest-only, principal at maturity)
//
// Inputs are always amount (principal), plazoMeses (term in months), apr
// (decimal annual percentage rate, e.g. 0.18 = 18%), and esquema. Output is
// the full schedule plus totals and derived rates. No Firestore.

const { VALID_ESQUEMAS } = require('./creditProductValidator');

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Validate shape of simulation inputs.
function validateSimulationInputs({ amount, plazoMeses, apr, esquema }) {
  const P = Number(amount);
  if (!Number.isFinite(P) || P <= 0) return 'amount must be > 0.';
  const n = Number(plazoMeses);
  if (!Number.isInteger(n) || n < 1 || n > 360) return 'plazoMeses must be integer in [1, 360].';
  const r = Number(apr);
  if (!Number.isFinite(r) || r < 0 || r > 1) return 'apr must be decimal in [0, 1].';
  if (!VALID_ESQUEMAS.has(esquema)) return 'esquema must be one of cuota_fija | amortizacion_constante | bullet.';
  return null;
}

// ─── Scheme implementations ───────────────────────────────────────────────

function amortizeCuotaFija(P, n, r) {
  const schedule = [];
  let balance = P;
  // PMT formula — safe for r = 0 which becomes straight-line.
  const payment = r === 0 ? P / n : P * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

  for (let m = 1; m <= n; m += 1) {
    const interest = balance * r;
    let principal = payment - interest;
    // Absorb rounding drift in the last month so balance closes at zero.
    if (m === n) principal = balance;
    balance -= principal;
    schedule.push({
      month: m,
      payment: round2(principal + interest),
      principal: round2(principal),
      interest: round2(interest),
      remainingBalance: round2(balance),
    });
  }
  return schedule;
}

function amortizeConstante(P, n, r) {
  const schedule = [];
  const principalPerMonth = P / n;
  let balance = P;
  for (let m = 1; m <= n; m += 1) {
    const interest = balance * r;
    let principal = principalPerMonth;
    if (m === n) principal = balance; // drift absorbed here too
    balance -= principal;
    schedule.push({
      month: m,
      payment: round2(principal + interest),
      principal: round2(principal),
      interest: round2(interest),
      remainingBalance: round2(balance),
    });
  }
  return schedule;
}

function amortizeBullet(P, n, r) {
  const schedule = [];
  const interestOnly = P * r;
  for (let m = 1; m <= n; m += 1) {
    const isFinal = m === n;
    const principal = isFinal ? P : 0;
    const balanceAfter = isFinal ? 0 : P;
    schedule.push({
      month: m,
      payment: round2(principal + interestOnly),
      principal: round2(principal),
      interest: round2(interestOnly),
      remainingBalance: round2(balanceAfter),
    });
  }
  return schedule;
}

// ─── Main ─────────────────────────────────────────────────────────────────

function simulateCost({ amount, plazoMeses, apr, esquema }) {
  const err = validateSimulationInputs({ amount, plazoMeses, apr, esquema });
  if (err) return { error: err };

  const P = Number(amount);
  const n = Number(plazoMeses);
  const aprYear = Number(apr);
  const r = aprYear / 12; // nominal monthly rate

  let schedule;
  if (esquema === 'cuota_fija') schedule = amortizeCuotaFija(P, n, r);
  else if (esquema === 'amortizacion_constante') schedule = amortizeConstante(P, n, r);
  else schedule = amortizeBullet(P, n, r);

  const totals = schedule.reduce((acc, row) => ({
    totalPayment: acc.totalPayment + row.payment,
    totalInterest: acc.totalInterest + row.interest,
    totalPrincipal: acc.totalPrincipal + row.principal,
  }), { totalPayment: 0, totalInterest: 0, totalPrincipal: 0 });

  const effectiveAnnualRate = r > 0 ? Math.pow(1 + r, 12) - 1 : 0;

  return {
    inputs: {
      amount: round2(P),
      plazoMeses: n,
      apr: aprYear,
      esquema,
    },
    monthlyRate: round2(r * 1e6) / 1e6, // 6-decimal precision on the rate
    effectiveAnnualRate: round2(effectiveAnnualRate * 1e6) / 1e6,
    schedule,
    totals: {
      totalPayment: round2(totals.totalPayment),
      totalInterest: round2(totals.totalInterest),
      totalPrincipal: round2(totals.totalPrincipal),
    },
  };
}

module.exports = {
  simulateCost,
  // exported for tests
  _internals: {
    amortizeCuotaFija,
    amortizeConstante,
    amortizeBullet,
    validateSimulationInputs,
  },
};
