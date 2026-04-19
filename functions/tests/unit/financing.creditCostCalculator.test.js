// Unit tests for the amortization calculator. Verifies each scheme against
// known-good math, boundary cases, and rounding drift.

const {
  simulateCost,
  _internals: { amortizeCuotaFija, amortizeConstante, amortizeBullet, validateSimulationInputs },
} = require('../../lib/financing/creditCostCalculator');

describe('validateSimulationInputs', () => {
  test.each([
    [{ amount: 0,    plazoMeses: 12, apr: 0.1, esquema: 'cuota_fija' }, /amount/],
    [{ amount: 1000, plazoMeses: 0,  apr: 0.1, esquema: 'cuota_fija' }, /plazoMeses/],
    [{ amount: 1000, plazoMeses: 12, apr: -0.1, esquema: 'cuota_fija' }, /apr/],
    [{ amount: 1000, plazoMeses: 12, apr: 0.1, esquema: 'weird' }, /esquema/],
  ])('rejects %j', (input, matcher) => {
    expect(validateSimulationInputs(input)).toMatch(matcher);
  });

  test('accepts valid input', () => {
    expect(validateSimulationInputs({ amount: 1000, plazoMeses: 12, apr: 0.1, esquema: 'cuota_fija' })).toBeNull();
  });
});

describe('amortizeCuotaFija', () => {
  test('zero-rate reduces to straight-line', () => {
    const schedule = amortizeCuotaFija(1200, 12, 0);
    expect(schedule).toHaveLength(12);
    for (const row of schedule) {
      expect(row.payment).toBe(100);
      expect(row.interest).toBe(0);
    }
    expect(schedule[11].remainingBalance).toBe(0);
  });

  test('balance closes to 0 with non-zero rate', () => {
    const schedule = amortizeCuotaFija(10000, 12, 0.015);
    expect(schedule[11].remainingBalance).toBe(0);
  });

  test('matches PMT formula (P=10000, apr=18%, n=12)', () => {
    const schedule = amortizeCuotaFija(10000, 12, 0.015);
    // PMT ≈ 916.80 per month
    for (let i = 0; i < 11; i += 1) {
      expect(schedule[i].payment).toBeCloseTo(916.80, 1);
    }
    // Sum of interest ≈ 1001.55 (rounded per-row drift gives ~1001.49)
    const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
    expect(totalInterest).toBeCloseTo(1001.55, 0);
  });
});

describe('amortizeConstante', () => {
  test('fixed principal per month; interest declines linearly at r=1%', () => {
    const schedule = amortizeConstante(1200, 12, 0.01);
    // Principal = 100/mo. Interest Month 1 = 12, Month 12 = 1.
    expect(schedule[0].principal).toBe(100);
    expect(schedule[0].interest).toBe(12);
    expect(schedule[11].principal).toBe(100);
    expect(schedule[11].interest).toBe(1);
    // Sum of interest = 12+11+...+1 = 78
    const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
    expect(totalInterest).toBeCloseTo(78, 2);
    expect(schedule[11].remainingBalance).toBe(0);
  });

  test('zero rate → payments all equal P/n, no interest', () => {
    const schedule = amortizeConstante(1200, 12, 0);
    for (const row of schedule) {
      expect(row.payment).toBe(100);
      expect(row.interest).toBe(0);
      expect(row.principal).toBe(100);
    }
  });
});

describe('amortizeBullet', () => {
  test('interest only until final month, principal in full at the end', () => {
    const schedule = amortizeBullet(10000, 12, 0.015);
    for (let i = 0; i < 11; i += 1) {
      expect(schedule[i].principal).toBe(0);
      expect(schedule[i].interest).toBe(150);
      expect(schedule[i].payment).toBe(150);
      expect(schedule[i].remainingBalance).toBe(10000);
    }
    expect(schedule[11].principal).toBe(10000);
    expect(schedule[11].interest).toBe(150);
    expect(schedule[11].payment).toBe(10150);
    expect(schedule[11].remainingBalance).toBe(0);
  });

  test('zero rate bullet = single balloon payment', () => {
    const schedule = amortizeBullet(5000, 6, 0);
    for (let i = 0; i < 5; i += 1) {
      expect(schedule[i].payment).toBe(0);
    }
    expect(schedule[5].payment).toBe(5000);
  });
});

describe('simulateCost — integration', () => {
  test('returns inputs echo + rates + totals', () => {
    const out = simulateCost({ amount: 10000, plazoMeses: 12, apr: 0.18, esquema: 'cuota_fija' });
    expect(out.inputs).toEqual({ amount: 10000, plazoMeses: 12, apr: 0.18, esquema: 'cuota_fija' });
    expect(out.monthlyRate).toBeCloseTo(0.015, 5);
    // effective annual = (1.015)^12 - 1 ≈ 0.1956
    expect(out.effectiveAnnualRate).toBeCloseTo(0.1956, 3);
    expect(out.schedule).toHaveLength(12);
    expect(out.totals.totalPrincipal).toBeCloseTo(10000, 1);
  });

  test('error propagates from validation', () => {
    const out = simulateCost({ amount: -1, plazoMeses: 12, apr: 0.1, esquema: 'cuota_fija' });
    expect(out.error).toBeDefined();
    expect(out.schedule).toBeUndefined();
  });

  test('bullet and constant produce different total interest for same inputs', () => {
    const inputs = { amount: 10000, plazoMeses: 12, apr: 0.18 };
    const bullet = simulateCost({ ...inputs, esquema: 'bullet' });
    const constante = simulateCost({ ...inputs, esquema: 'amortizacion_constante' });
    // Bullet keeps full principal throughout → higher interest.
    expect(bullet.totals.totalInterest).toBeGreaterThan(constante.totals.totalInterest);
  });

  test('zero-APR produces zero interest regardless of scheme', () => {
    for (const esquema of ['cuota_fija', 'amortizacion_constante', 'bullet']) {
      const out = simulateCost({ amount: 1200, plazoMeses: 12, apr: 0, esquema });
      expect(out.totals.totalInterest).toBe(0);
      expect(out.totals.totalPrincipal).toBe(1200);
    }
  });
});
