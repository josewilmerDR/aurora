// Unit tests for consumption stats. Pure.

const { weeklyConsumptionByProduct } = require('../../lib/procurement/consumptionStats');

const day = (iso) => new Date(iso + 'T12:00:00Z');
const mov = (productoId, cantidad, fechaIso, overrides = {}) => ({
  productoId, cantidad, fecha: day(fechaIso), tipo: 'egreso', ...overrides,
});

describe('weeklyConsumptionByProduct', () => {
  test('averages across the lookback window', () => {
    const now = day('2026-03-01');
    const movimientos = [
      mov('P1', 10, '2026-01-15'),
      mov('P1', 20, '2026-02-01'),
      mov('P1', 30, '2026-02-20'),
    ];
    const out = weeklyConsumptionByProduct(movimientos, { now, lookbackWeeks: 8 });
    expect(out.P1.totalInWindow).toBe(60);
    expect(out.P1.sampleCount).toBe(3);
    // First observation 2026-01-15, now 2026-03-01 → ~6.57 weeks elapsed;
    // denominator = min(8, 6.57) = 6.57. Weekly avg ≈ 60 / 6.57 ≈ 9.13.
    expect(out.P1.weeklyAvg).toBeGreaterThan(9);
    expect(out.P1.weeklyAvg).toBeLessThan(10);
  });

  test('ignores movements outside the lookback window', () => {
    const now = day('2026-03-01');
    const movimientos = [
      mov('P1', 100, '2025-10-01'), // well outside 8 weeks
      mov('P1', 10, '2026-02-25'),
    ];
    const out = weeklyConsumptionByProduct(movimientos, { now, lookbackWeeks: 8 });
    expect(out.P1.totalInWindow).toBe(10);
  });

  test('ignores movements with wrong tipo', () => {
    const now = day('2026-03-01');
    const movimientos = [
      mov('P1', 10, '2026-02-20', { tipo: 'ingreso' }),
      mov('P1', 5, '2026-02-22'),
    ];
    const out = weeklyConsumptionByProduct(movimientos, { now });
    expect(out.P1.totalInWindow).toBe(5);
  });

  test('new product consumed just once gets a weekly avg scaled to elapsed time', () => {
    const now = day('2026-03-01');
    // Only 3 days of history → denominator clamps to min(lookback, elapsedWeeks)
    const movimientos = [mov('P1', 10, '2026-02-26')];
    const out = weeklyConsumptionByProduct(movimientos, { now, lookbackWeeks: 8 });
    // 3 days ≈ 0.43 weeks → weeklyAvg = 10 / 0.43 ≈ 23
    expect(out.P1.weeklyAvg).toBeGreaterThan(20);
  });

  test('denominator never drops below 1/7 week (a single day)', () => {
    const now = day('2026-03-01');
    const movimientos = [mov('P1', 10, '2026-03-01')]; // same day
    const out = weeklyConsumptionByProduct(movimientos, { now });
    // Upper bound check — would be 10 / (1/7) = 70 weekly
    expect(out.P1.weeklyAvg).toBeLessThanOrEqual(70);
    expect(out.P1.weeklyAvg).toBeGreaterThan(0);
  });

  test('skips movements with missing productoId or invalid qty', () => {
    const now = day('2026-03-01');
    const movimientos = [
      mov(null, 10, '2026-02-20'),
      mov('P1', 0, '2026-02-20'),
      mov('P1', -5, '2026-02-20'),
      mov('P1', 5, '2026-02-22'),
    ];
    const out = weeklyConsumptionByProduct(movimientos, { now });
    expect(Object.keys(out)).toEqual(['P1']);
    expect(out.P1.totalInWindow).toBe(5);
  });

  test('accepts ISO strings and firestore-like Timestamp objects for fecha', () => {
    const now = day('2026-03-01');
    const movimientos = [
      { productoId: 'P1', cantidad: 5, tipo: 'egreso', fecha: '2026-02-20T12:00:00Z' },
      { productoId: 'P1', cantidad: 3, tipo: 'egreso', fecha: { toDate: () => day('2026-02-22') } },
    ];
    const out = weeklyConsumptionByProduct(movimientos, { now });
    expect(out.P1.totalInWindow).toBe(8);
  });

  test('empty input returns empty object', () => {
    expect(weeklyConsumptionByProduct([])).toEqual({});
    expect(weeklyConsumptionByProduct(null)).toEqual({});
  });

  test('custom tipo allows other flows (e.g. salida for bodega genérica)', () => {
    const now = day('2026-03-01');
    const movimientos = [
      { productoId: 'P1', cantidad: 10, tipo: 'salida', fecha: day('2026-02-20') },
      { productoId: 'P1', cantidad: 5, tipo: 'egreso', fecha: day('2026-02-20') },
    ];
    const out = weeklyConsumptionByProduct(movimientos, { now, tipo: 'salida' });
    expect(out.P1.totalInWindow).toBe(10);
  });
});
