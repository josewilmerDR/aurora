// Unit tests for supplier price stats. Pure.

const { pricesByProduct, marketMedianByProduct } = require('../../lib/procurement/supplierPriceStats');

const order = (items) => ({ items });
const item = (productoId, cantidad, precioUnitario, extra = {}) => ({
  productoId, cantidad, precioUnitario, moneda: 'USD', unidad: 'L', ...extra,
});

describe('pricesByProduct', () => {
  test('quantity-weighted average across multiple orders', () => {
    const orders = [
      order([item('P1', 10, 100)]), // 1000
      order([item('P1', 30, 120)]), // 3600
    ];
    const out = pricesByProduct(orders);
    // Weighted: (10*100 + 30*120) / 40 = 4600/40 = 115
    expect(out.P1.avgPrice).toBe(115);
    expect(out.P1.sampleCount).toBe(2);
    expect(out.P1.unit).toBe('L');
  });

  test('falls back to nombreComercial key when productoId missing', () => {
    const orders = [order([item(null, 5, 50, { nombreComercial: 'Urea 46' })])];
    const out = pricesByProduct(orders);
    expect(out['urea 46'].avgPrice).toBe(50);
  });

  test('ignores items in other currencies', () => {
    const orders = [order([
      item('P1', 10, 100, { moneda: 'USD' }),
      item('P1', 10, 60000, { moneda: 'CRC' }),
    ])];
    expect(pricesByProduct(orders, 'USD').P1.avgPrice).toBe(100);
  });

  test('skips items with non-positive price or qty', () => {
    const orders = [order([
      item('P1', 0, 100),
      item('P1', 10, 0),
      item('P1', 10, 50),
    ])];
    expect(pricesByProduct(orders).P1.avgPrice).toBe(50);
    expect(pricesByProduct(orders).P1.sampleCount).toBe(1);
  });

  test('empty or malformed input → empty object', () => {
    expect(pricesByProduct([])).toEqual({});
    expect(pricesByProduct(null)).toEqual({});
    expect(pricesByProduct([{}])).toEqual({});
  });
});

describe('marketMedianByProduct', () => {
  test('median across all suppliers', () => {
    const orders = [
      order([item('P1', 1, 100)]),
      order([item('P1', 1, 150)]),
      order([item('P1', 1, 200)]),
    ];
    expect(marketMedianByProduct(orders).P1.median).toBe(150);
    expect(marketMedianByProduct(orders).P1.sampleCount).toBe(3);
  });

  test('even-count median averages the two middles', () => {
    const orders = [
      order([item('P1', 1, 100), item('P1', 1, 200)]),
    ];
    expect(marketMedianByProduct(orders).P1.median).toBe(150);
  });

  test('uses raw item price, not quantity-weighted', () => {
    // The median is a per-line signal; huge orders do not skew it.
    const orders = [
      order([item('P1', 10000, 1)]),
      order([item('P1', 1, 100)]),
      order([item('P1', 1, 200)]),
    ];
    expect(marketMedianByProduct(orders).P1.median).toBe(100);
  });

  test('filters by currency', () => {
    const orders = [
      order([item('P1', 1, 100, { moneda: 'USD' })]),
      order([item('P1', 1, 60000, { moneda: 'CRC' })]),
    ];
    expect(marketMedianByProduct(orders, 'CRC').P1.median).toBe(60000);
  });
});
