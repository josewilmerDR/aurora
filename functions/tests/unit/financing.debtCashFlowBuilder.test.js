// Unit tests for the debt cash flow builder. Pure — no Firestore.

const {
  buildDebtCashFlow,
  applyUseCaseToMonths,
} = require('../../lib/financing/debtCashFlowBuilder');

describe('buildDebtCashFlow — validation', () => {
  test.each([
    [{ amount: 10000, plazoMeses: 6, apr: 0.1, esquema: 'cuota_fija', horizonteMeses: 0 }, /horizonteMeses/],
    [{ amount: 10000, plazoMeses: 6, apr: 0.1, esquema: 'cuota_fija', horizonteMeses: 12, disbursementMonth: 12 }, /disbursementMonth/],
    [{ amount: 0, plazoMeses: 6, apr: 0.1, esquema: 'cuota_fija' }, /amount/],
  ])('rejects invalid input %j', (input, matcher) => {
    expect(buildDebtCashFlow(input).error).toMatch(matcher);
  });
});

describe('buildDebtCashFlow — disbursement placement', () => {
  test('month-0 disbursement lands at index 0, rest zeros', () => {
    const out = buildDebtCashFlow({
      amount: 10000, plazoMeses: 6, apr: 0.12, esquema: 'cuota_fija', horizonteMeses: 12,
    });
    expect(out.disbursementByMonth[0]).toBe(10000);
    expect(out.disbursementByMonth.slice(1).every(v => v === 0)).toBe(true);
  });

  test('non-zero disbursementMonth shifts the inflow', () => {
    const out = buildDebtCashFlow({
      amount: 5000, plazoMeses: 3, apr: 0.10, esquema: 'cuota_fija', horizonteMeses: 12, disbursementMonth: 2,
    });
    expect(out.disbursementByMonth[2]).toBe(5000);
    expect(out.disbursementByMonth[0]).toBe(0);
    expect(out.disbursementByMonth[1]).toBe(0);
  });
});

describe('buildDebtCashFlow — payment placement', () => {
  test('loan fits within horizon — all payments captured', () => {
    const out = buildDebtCashFlow({
      amount: 10000, plazoMeses: 6, apr: 0.12, esquema: 'cuota_fija', horizonteMeses: 12,
    });
    // Payment 1 at idx 0, payment 6 at idx 5, idx 6..11 zero.
    expect(out.paymentsByMonth[0]).toBeGreaterThan(0);
    expect(out.paymentsByMonth[5]).toBeGreaterThan(0);
    expect(out.paymentsByMonth.slice(6).every(v => v === 0)).toBe(true);
    expect(out.truncated).toBe(false);
    expect(out.remainingBalanceAtHorizon).toBe(0);
  });

  test('loan exceeds horizon — payments truncated, remaining balance reported', () => {
    const out = buildDebtCashFlow({
      amount: 24000, plazoMeses: 24, apr: 0.12, esquema: 'cuota_fija', horizonteMeses: 12,
    });
    expect(out.truncated).toBe(true);
    expect(out.truncatedMonthsCount).toBe(12); // 24 payments, 12 drop off
    expect(out.remainingBalanceAtHorizon).toBeGreaterThan(0);
    expect(out.paymentsByMonth.every(v => v > 0)).toBe(true); // all 12 months have a payment
  });

  test('bullet scheme: all-but-last month = interest only, last = balloon', () => {
    const out = buildDebtCashFlow({
      amount: 10000, plazoMeses: 12, apr: 0.12, esquema: 'bullet', horizonteMeses: 12,
    });
    // Month 0..10 interest only (=100); month 11 = 10000 + 100 = 10100.
    for (let i = 0; i < 11; i += 1) {
      expect(out.paymentsByMonth[i]).toBe(100);
    }
    expect(out.paymentsByMonth[11]).toBeCloseTo(10100, 1);
  });
});

describe('buildDebtCashFlow — totals', () => {
  test('matches simulateCost totals', () => {
    const out = buildDebtCashFlow({
      amount: 10000, plazoMeses: 12, apr: 0.12, esquema: 'cuota_fija', horizonteMeses: 12,
    });
    expect(out.schedule).toHaveLength(12);
    expect(out.totalPayment).toBeGreaterThan(10000);
    expect(out.totalInterest).toBeGreaterThan(0);
    expect(out.monthlyPayment).toBeGreaterThan(0);
  });

  test('zero APR: totalInterest = 0, sum of payments = principal', () => {
    const out = buildDebtCashFlow({
      amount: 1200, plazoMeses: 12, apr: 0, esquema: 'cuota_fija', horizonteMeses: 12,
    });
    expect(out.totalInterest).toBe(0);
    expect(out.totalPayment).toBe(1200);
  });
});

// ─── applyUseCaseToMonths ─────────────────────────────────────────────────

describe('applyUseCaseToMonths', () => {
  test('missing / none model → zero arrays', () => {
    expect(applyUseCaseToMonths(null, 6)).toEqual({
      extraRevenueByMonth: [0, 0, 0, 0, 0, 0],
      extraCostByMonth: [0, 0, 0, 0, 0, 0],
    });
    expect(applyUseCaseToMonths({ expectedReturnModel: { kind: 'none' } }, 6)).toEqual({
      extraRevenueByMonth: [0, 0, 0, 0, 0, 0],
      extraCostByMonth: [0, 0, 0, 0, 0, 0],
    });
  });

  test('linear: constant revenue boost from startMonth', () => {
    const out = applyUseCaseToMonths({
      expectedReturnModel: { kind: 'linear', monthlyIncrease: 500, startMonth: 2 },
    }, 6);
    expect(out.extraRevenueByMonth).toEqual([0, 0, 500, 500, 500, 500]);
    expect(out.extraCostByMonth).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test('delayed_revenue: zeros before startMonth, then monthlyIncrease', () => {
    const out = applyUseCaseToMonths({
      expectedReturnModel: { kind: 'delayed_revenue', monthlyIncrease: 1000, startMonth: 3 },
    }, 6);
    expect(out.extraRevenueByMonth).toEqual([0, 0, 0, 1000, 1000, 1000]);
  });

  test('cost_reduction: extraCostByMonth is negative (reduction)', () => {
    const out = applyUseCaseToMonths({
      expectedReturnModel: { kind: 'cost_reduction', monthlyCostReduction: 200, startMonth: 0 },
    }, 4);
    expect(out.extraCostByMonth).toEqual([-200, -200, -200, -200]);
    expect(out.extraRevenueByMonth).toEqual([0, 0, 0, 0]);
  });
});
