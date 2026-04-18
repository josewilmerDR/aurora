// Unit tests for the supplier scoring lib. Pure.

const { scoreSupplier, DEFAULT_WEIGHTS } = require('../../lib/procurement/supplierScore');

const signals = (overrides = {}) => ({
  supplierName: 'X',
  orderCount: 0,
  avgLeadTimeDays: null,
  fillRate: null,
  pricesByProduct: {},
  ...overrides,
});

describe('scoreSupplier', () => {
  test('returns null score when no signals are present', () => {
    const out = scoreSupplier(signals(), {});
    expect(out.score).toBeNull();
  });

  test('price subscore = 50 when supplier is at market median', () => {
    const s = signals({
      orderCount: 5,
      avgLeadTimeDays: 15,
      fillRate: 1,
      pricesByProduct: { P1: { avgPrice: 100, sampleCount: 3 } },
    });
    const market = { P1: { median: 100, sampleCount: 10 } };
    const out = scoreSupplier(s, market);
    expect(out.breakdown.price.value).toBe(50);
  });

  test('cheaper than market → higher price subscore', () => {
    const s = signals({ orderCount: 1, pricesByProduct: { P1: { avgPrice: 80, sampleCount: 1 } } });
    const out = scoreSupplier(s, { P1: { median: 100 } });
    // index=0.8, spread=0.5 → 50 + (1-0.8)*(100) = 70
    expect(out.breakdown.price.value).toBe(70);
  });

  test('50% above market → price subscore = 0', () => {
    const s = signals({ orderCount: 1, pricesByProduct: { P1: { avgPrice: 150, sampleCount: 1 } } });
    const out = scoreSupplier(s, { P1: { median: 100 } });
    expect(out.breakdown.price.value).toBe(0);
  });

  test('leadTime subscore: 0 days = 100, cutoff days = 0', () => {
    expect(scoreSupplier(signals({ avgLeadTimeDays: 0 }), {}).breakdown.leadTime.value).toBe(100);
    expect(scoreSupplier(signals({ avgLeadTimeDays: 30 }), {}).breakdown.leadTime.value).toBe(0);
    expect(scoreSupplier(signals({ avgLeadTimeDays: 15 }), {}).breakdown.leadTime.value).toBe(50);
  });

  test('fillRate subscore mirrors the fill rate', () => {
    expect(scoreSupplier(signals({ fillRate: 1 }), {}).breakdown.fillRate.value).toBe(100);
    expect(scoreSupplier(signals({ fillRate: 0.75 }), {}).breakdown.fillRate.value).toBe(75);
  });

  test('history subscore caps at 100 past the threshold', () => {
    expect(scoreSupplier(signals({ orderCount: 20 }), {}).breakdown.history.value).toBe(100);
    expect(scoreSupplier(signals({ orderCount: 5 }), {}).breakdown.history.value).toBe(50);
  });

  test('missing signals are skipped and remaining weights renormalize', () => {
    // Only leadTime available → score equals leadTime subscore regardless of weight.
    const s = signals({ avgLeadTimeDays: 0 });
    const out = scoreSupplier(s, {});
    expect(out.score).toBe(100);
    expect(out.breakdown.price.value).toBeNull();
    expect(out.breakdown.history.value).toBeNull();
  });

  test('productoId narrows price subscore to that product', () => {
    const s = signals({
      pricesByProduct: {
        P1: { avgPrice: 80, sampleCount: 1 },   // cheaper
        P2: { avgPrice: 200, sampleCount: 1 },  // more expensive
      },
    });
    const market = { P1: { median: 100 }, P2: { median: 100 } };
    const full = scoreSupplier(s, market);
    const focused = scoreSupplier(s, market, { productoId: 'P1' });
    expect(focused.breakdown.price.value).toBe(70); // just P1
    expect(focused.breakdown.price.value).not.toBe(full.breakdown.price.value);
  });

  test('weight overrides change the final score', () => {
    const s = signals({ avgLeadTimeDays: 0, fillRate: 0 });
    const out = scoreSupplier(s, {}, { weights: { leadTime: 1, fillRate: 0 } });
    // Effective: only leadTime contributes.
    expect(out.score).toBe(100);
  });

  test('default weights are frozen and sum to 1', () => {
    expect(Object.isFrozen(DEFAULT_WEIGHTS)).toBe(true);
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  test('quantity-weighted price across products when productoId unset', () => {
    const s = signals({
      pricesByProduct: {
        P1: { avgPrice: 80, sampleCount: 3 },   // cheaper, high weight
        P2: { avgPrice: 120, sampleCount: 1 },  // pricier, low weight
      },
    });
    const market = { P1: { median: 100 }, P2: { median: 100 } };
    const out = scoreSupplier(s, market);
    // P1 sub=70 (index 0.8), P2 sub=30 (index 1.2) → weighted avg: (70*3 + 30*1)/4 = 60
    expect(out.breakdown.price.value).toBe(60);
  });
});
