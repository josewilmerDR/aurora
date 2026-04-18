// Unit tests for the RFQ winner picker. Pure.

const { pickWinner } = require('../../lib/procurement/rfqWinner');

const resp = (overrides) => ({
  supplierId: 'S1',
  supplierName: 'Supplier 1',
  precioUnitario: 100,
  disponible: true,
  leadTimeDays: 7,
  respondedAt: new Date('2026-04-20T12:00:00Z'),
  ...overrides,
});

describe('pickWinner', () => {
  test('picks the cheapest eligible response', () => {
    const out = pickWinner([
      resp({ supplierId: 'A', precioUnitario: 120 }),
      resp({ supplierId: 'B', precioUnitario: 90 }),
      resp({ supplierId: 'C', precioUnitario: 100 }),
    ]);
    expect(out.winner.supplierId).toBe('B');
    expect(out.rankedEligible.map(r => r.supplierId)).toEqual(['B', 'C', 'A']);
    expect(out.rejected).toEqual([]);
  });

  test('ties on price break on shortest lead time', () => {
    const out = pickWinner([
      resp({ supplierId: 'A', precioUnitario: 100, leadTimeDays: 10 }),
      resp({ supplierId: 'B', precioUnitario: 100, leadTimeDays: 3 }),
    ]);
    expect(out.winner.supplierId).toBe('B');
  });

  test('rejects unavailable responses', () => {
    const out = pickWinner([
      resp({ supplierId: 'A', disponible: false }),
      resp({ supplierId: 'B' }),
    ]);
    expect(out.winner.supplierId).toBe('B');
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].supplierId).toBe('A');
    expect(out.rejected[0].reason).toMatch(/no disponible/i);
  });

  test('rejects invalid price or negative lead time', () => {
    const out = pickWinner([
      resp({ supplierId: 'A', precioUnitario: 0 }),
      resp({ supplierId: 'B', leadTimeDays: -1 }),
      resp({ supplierId: 'C' }),
    ]);
    expect(out.winner.supplierId).toBe('C');
    expect(out.rejected).toHaveLength(2);
  });

  test('respects maxLeadTimeDays', () => {
    const out = pickWinner(
      [resp({ supplierId: 'A', precioUnitario: 80, leadTimeDays: 20 }),
       resp({ supplierId: 'B', precioUnitario: 100, leadTimeDays: 5 })],
      { maxLeadTimeDays: 10 }
    );
    expect(out.winner.supplierId).toBe('B');
    expect(out.rejected[0].supplierId).toBe('A');
    expect(out.rejected[0].reason).toMatch(/20d excede el máximo/);
  });

  test('rejects mismatched currency when filter is set', () => {
    const out = pickWinner(
      [resp({ supplierId: 'A', moneda: 'CRC' }),
       resp({ supplierId: 'B', moneda: 'USD' })],
      { currency: 'USD' }
    );
    expect(out.winner.supplierId).toBe('B');
    expect(out.rejected[0].supplierId).toBe('A');
  });

  test('returns null winner when no eligible responses', () => {
    const out = pickWinner([resp({ disponible: false })]);
    expect(out.winner).toBeNull();
    expect(out.rankedEligible).toEqual([]);
  });

  test('empty input is handled', () => {
    expect(pickWinner([])).toEqual({ winner: null, rankedEligible: [], rejected: [] });
    expect(pickWinner()).toEqual({ winner: null, rankedEligible: [], rejected: [] });
  });
});
