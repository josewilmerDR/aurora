// Unit tests for supplier delivery signals. Pure.

const { avgLeadTimeDays, fillRate } = require('../../lib/procurement/supplierDelivery');

const day = (iso) => new Date(iso + 'T12:00:00Z');

describe('avgLeadTimeDays', () => {
  test('joins by ordenCompraId and averages across orders', () => {
    const orders = [
      { id: 'O1', poNumber: 'OC-1', fecha: day('2026-01-01') },
      { id: 'O2', poNumber: 'OC-2', fecha: day('2026-01-10') },
    ];
    const receptions = [
      { ordenCompraId: 'O1', fechaRecepcion: day('2026-01-06') }, // 5 days
      { ordenCompraId: 'O2', fechaRecepcion: day('2026-01-13') }, // 3 days
    ];
    const out = avgLeadTimeDays(orders, receptions);
    expect(out.sampleCount).toBe(2);
    expect(out.avgDays).toBe(4);
  });

  test('falls back to poNumber when ordenCompraId is missing', () => {
    const orders = [{ id: 'O1', poNumber: 'OC-1', fecha: day('2026-01-01') }];
    const receptions = [{ poNumber: 'OC-1', fechaRecepcion: day('2026-01-08') }];
    expect(avgLeadTimeDays(orders, receptions).avgDays).toBe(7);
  });

  test('partial deliveries only count the first reception', () => {
    const orders = [{ id: 'O1', fecha: day('2026-01-01') }];
    const receptions = [
      { ordenCompraId: 'O1', fechaRecepcion: day('2026-01-05') }, // 4d — wins
      { ordenCompraId: 'O1', fechaRecepcion: day('2026-01-12') }, // 11d — ignored
    ];
    expect(avgLeadTimeDays(orders, receptions).avgDays).toBe(4);
  });

  test('returns null when there are no samples', () => {
    expect(avgLeadTimeDays([], [])).toEqual({ avgDays: null, sampleCount: 0 });
  });

  test('skips receptions whose order has no fecha', () => {
    const orders = [{ id: 'O1', fecha: null }];
    const receptions = [{ ordenCompraId: 'O1', fechaRecepcion: day('2026-01-05') }];
    expect(avgLeadTimeDays(orders, receptions).sampleCount).toBe(0);
  });

  test('skips negative lead times (data glitches)', () => {
    const orders = [{ id: 'O1', fecha: day('2026-01-10') }];
    const receptions = [{ ordenCompraId: 'O1', fechaRecepcion: day('2026-01-05') }];
    expect(avgLeadTimeDays(orders, receptions).sampleCount).toBe(0);
  });
});

describe('fillRate', () => {
  test('sums across receptions and divides', () => {
    const receptions = [
      { items: [{ cantidadOC: 100, cantidadRecibida: 80 }] },
      { items: [{ cantidadOC: 50, cantidadRecibida: 50 }] },
    ];
    const out = fillRate(receptions);
    expect(out.rate).toBeCloseTo(130 / 150, 4);
    expect(out.sampleCount).toBe(2);
  });

  test('ignores items with invalid cantidadOC', () => {
    const receptions = [
      { items: [
        { cantidadOC: 0, cantidadRecibida: 5 },
        { cantidadOC: 100, cantidadRecibida: 100 },
      ] },
    ];
    expect(fillRate(receptions).rate).toBe(1);
  });

  test('returns null when nothing to measure', () => {
    expect(fillRate([])).toEqual({ rate: null, sampleCount: 0 });
    expect(fillRate([{ items: [] }])).toEqual({ rate: null, sampleCount: 0 });
  });

  test('caps negative cantidadRecibida as invalid', () => {
    const receptions = [{ items: [{ cantidadOC: 100, cantidadRecibida: -5 }] }];
    expect(fillRate(receptions).rate).toBe(null);
  });
});
