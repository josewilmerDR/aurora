// Unit tests for the supplier-signals composer. Pure.

const { collectSupplierSignals } = require('../../lib/procurement/supplierSignals');

const day = (iso) => new Date(iso + 'T12:00:00Z');
const item = (productoId, cantidad, precioUnitario, extra = {}) => ({
  productoId, cantidad, precioUnitario, moneda: 'USD', unidad: 'L', ...extra,
});

describe('collectSupplierSignals', () => {
  test('filters orders by supplier name and joins receptions by id', () => {
    const orders = [
      { id: 'O1', poNumber: 'OC-1', proveedor: 'Agro Insumos', fecha: day('2026-01-01'),
        items: [item('P1', 10, 100)] },
      { id: 'O2', poNumber: 'OC-2', proveedor: 'Otro Proveedor', fecha: day('2026-01-05'),
        items: [item('P1', 10, 80)] },
    ];
    const receptions = [
      { ordenCompraId: 'O1', fechaRecepcion: day('2026-01-06'),
        items: [{ productoId: 'P1', cantidadOC: 10, cantidadRecibida: 9 }] },
      { ordenCompraId: 'O2', fechaRecepcion: day('2026-01-10'),
        items: [{ productoId: 'P1', cantidadOC: 10, cantidadRecibida: 10 }] },
    ];
    const out = collectSupplierSignals({
      supplierName: 'Agro Insumos',
      orders,
      receptions,
    });
    expect(out.orderCount).toBe(1);
    expect(out.receptionCount).toBe(1);
    expect(out.avgLeadTimeDays).toBe(5);
    expect(out.fillRate).toBeCloseTo(0.9, 4);
    expect(out.pricesByProduct.P1.avgPrice).toBe(100);
    expect(out.productosOfrecidos).toEqual(['P1']);
    expect(out.lastOrderDate).toEqual(day('2026-01-01'));
  });

  test('matches receptions by name when ordenCompraId is missing', () => {
    const orders = [
      { id: 'O1', proveedor: 'Agro', fecha: day('2026-01-01'),
        items: [item('P1', 10, 100)] },
    ];
    const receptions = [
      { proveedor: 'AGRO', fechaRecepcion: day('2026-01-10'),
        items: [{ productoId: 'P1', cantidadOC: 10, cantidadRecibida: 10 }] },
    ];
    const out = collectSupplierSignals({ supplierName: 'Agro', orders, receptions });
    expect(out.receptionCount).toBe(1);
    expect(out.fillRate).toBe(1);
  });

  test('honors aliases when matching the supplier name', () => {
    const orders = [
      { id: 'O1', proveedor: 'ACME', fecha: day('2026-01-01'),
        items: [item('P1', 5, 20)] },
    ];
    const out = collectSupplierSignals({
      supplierName: 'Agro Insumos',
      aliases: ['ACME'],
      orders,
      receptions: [],
    });
    expect(out.orderCount).toBe(1);
  });

  test('returns nulls and zero counts for a supplier with no history', () => {
    const out = collectSupplierSignals({
      supplierName: 'Nuevo Proveedor',
      orders: [],
      receptions: [],
    });
    expect(out.orderCount).toBe(0);
    expect(out.avgLeadTimeDays).toBeNull();
    expect(out.fillRate).toBeNull();
    expect(out.pricesByProduct).toEqual({});
    expect(out.lastOrderDate).toBeNull();
  });

  test('lastOrderDate picks the most recent matching order', () => {
    const orders = [
      { id: 'O1', proveedor: 'X', fecha: day('2026-01-01'), items: [] },
      { id: 'O2', proveedor: 'X', fecha: day('2026-03-01'), items: [] },
      { id: 'O3', proveedor: 'X', fecha: day('2026-02-01'), items: [] },
    ];
    expect(collectSupplierSignals({ supplierName: 'X', orders }).lastOrderDate)
      .toEqual(day('2026-03-01'));
  });
});
