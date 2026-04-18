// Unit tests for the stock-gap analyzer. Pure.

const { analyzeStock, DEFAULT_OPTS } = require('../../lib/procurement/stockAnalyzer');

const prod = (overrides = {}) => ({
  id: 'P1', nombreComercial: 'Urea', unidad: 'kg',
  stockActual: 100, stockMinimo: 50, ...overrides,
});

const cons = (weeklyAvg) => ({ [prod().id]: { weeklyAvg, totalInWindow: weeklyAvg * 8, sampleCount: 8 } });

describe('analyzeStock', () => {
  test('flags product with zero stock as critical', () => {
    const gaps = analyzeStock({ products: [prod({ stockActual: 0 })], consumption: {} });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].urgency).toBe('critical');
    expect(gaps[0].reason).toMatch(/agotado/i);
  });

  test('suggests leadTimeDemand + stockMinimo - stockActual when consumption is known', () => {
    // weeklyAvg=70 → daily=10; lead 14 days, safety 1.2 → demand = 10*14*1.2 = 168
    // target = max(50, 168+50) = 218; suggested = 218 - 100 = 118
    const gaps = analyzeStock({
      products: [prod({ stockActual: 100, stockMinimo: 50 })],
      consumption: cons(70),
    });
    expect(gaps[0].suggestedQty).toBe(118);
    expect(gaps[0].leadTimeDemand).toBe(168);
  });

  test('classifies urgency by days-until-stockout vs lead time', () => {
    // stock 100, daily 20 → 5 days cover, lead 14 → 5 < 14*0.5 → critical
    const critical = analyzeStock({
      products: [prod({ stockActual: 100, stockMinimo: 50 })],
      consumption: cons(140),
    });
    expect(critical[0].urgency).toBe('critical');

    // stock 100, daily 10 → 10 days cover → between 7 (50%) and 14 → high
    const high = analyzeStock({
      products: [prod({ stockActual: 100, stockMinimo: 50 })],
      consumption: cons(70),
    });
    expect(high[0].urgency).toBe('high');

    // stock 200, daily 10 → 20 days cover → between 14 and 21 (14*1.5) → medium
    const medium = analyzeStock({
      products: [prod({ stockActual: 200, stockMinimo: 50 })],
      consumption: cons(70),
    });
    expect(medium[0].urgency).toBe('medium');
  });

  test('falls back to stockMinimo rule when there is no consumption history', () => {
    const gaps = analyzeStock({
      products: [prod({ stockActual: 30, stockMinimo: 50 })],
      consumption: {},
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].suggestedQty).toBe(20); // 50 - 30
    expect(gaps[0].urgency).toBe('medium');
    expect(gaps[0].reason).toMatch(/sin historial/i);
  });

  test('skips healthy products', () => {
    const gaps = analyzeStock({
      products: [prod({ stockActual: 500, stockMinimo: 50 })],
      consumption: cons(10), // 1.4 daily → 357 days cover, target well below stock
    });
    expect(gaps).toEqual([]);
  });

  test('flags a product above stockMinimo but with short coverage', () => {
    // stock 100, daily 15 → 6.6 days cover → below lead time → high urgency
    const gaps = analyzeStock({
      products: [prod({ stockActual: 100, stockMinimo: 50 })],
      consumption: cons(15 * 7),
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].urgency).toBe('critical'); // 6.6 < 7 (50% of 14)
  });

  test('sorts output by urgency (critical first)', () => {
    const products = [
      prod({ id: 'P-low', stockActual: 500, stockMinimo: 50 }),
      prod({ id: 'P-crit', stockActual: 0, stockMinimo: 50 }),
      prod({ id: 'P-high', stockActual: 100, stockMinimo: 50 }),
      prod({ id: 'P-med', stockActual: 30, stockMinimo: 50 }),
    ];
    const consumption = {
      'P-high': { weeklyAvg: 70 }, // high
      // P-med has no consumption → medium via stockMinimo
    };
    const gaps = analyzeStock({ products, consumption });
    const ids = gaps.map(g => g.productoId);
    expect(ids[0]).toBe('P-crit');
    expect(ids[1]).toBe('P-high');
    expect(ids[2]).toBe('P-med');
    // P-low might not appear (healthy + no consumption) — just make sure crit/high/med order is preserved
  });

  test('respects custom lead time and safety factor', () => {
    const gaps = analyzeStock({
      products: [prod({ stockActual: 100, stockMinimo: 50 })],
      consumption: cons(70),
      opts: { leadTimeDays: 7, safetyFactor: 1.0 },
    });
    // daily=10, demand = 10*7*1 = 70; target = max(50, 70+50) = 120; suggested = 20
    expect(gaps[0].suggestedQty).toBe(20);
    expect(gaps[0].leadTimeDemand).toBe(70);
  });

  test('empty input returns empty array', () => {
    expect(analyzeStock({})).toEqual([]);
    expect(analyzeStock({ products: [], consumption: {} })).toEqual([]);
  });

  test('DEFAULT_OPTS is frozen', () => {
    expect(Object.isFrozen(DEFAULT_OPTS)).toBe(true);
  });
});
