// Unit tests for the procurement candidate builder. Pure.

const { buildProcurementCandidates, URGENCY_TO_PRIORITY } = require('../../lib/procurement/procurementCandidates');
const { marketMedianByProduct } = require('../../lib/procurement/supplierPriceStats');

const day = (iso) => new Date(iso + 'T12:00:00Z');
const item = (productoId, cantidad, precioUnitario) => ({
  productoId, cantidad, precioUnitario, moneda: 'USD', unidad: 'L',
});

const gap = (overrides = {}) => ({
  productoId: 'P1',
  nombreComercial: 'Urea',
  unidad: 'kg',
  stockActual: 10,
  stockMinimo: 50,
  weeklyConsumption: 20,
  suggestedQty: 100,
  urgency: 'high',
  reason: 'Stock cubre 3 días.',
  ...overrides,
});

describe('buildProcurementCandidates', () => {
  test('produces OC candidate when top supplier clears the minimum score', () => {
    const suppliers = [
      { id: 'S-good', nombre: 'Barato SA' },
      { id: 'S-bad', nombre: 'Caro SA' },
    ];
    const orders = [
      // Many cheap orders from good supplier → high score
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `OG${i}`, proveedor: 'Barato SA', fecha: day('2026-02-01'),
        items: [item('P1', 10, 80)],
      })),
      { id: 'OB1', proveedor: 'Caro SA', fecha: day('2026-02-01'),
        items: [item('P1', 1, 150)] },
    ];
    const receptions = orders
      .filter(o => o.proveedor === 'Barato SA')
      .map((o, i) => ({
        ordenCompraId: o.id, fechaRecepcion: day('2026-02-05'),
        items: [{ productoId: 'P1', cantidadOC: 10, cantidadRecibida: 10 }],
      }));
    const marketMedians = marketMedianByProduct(orders);

    const candidates = buildProcurementCandidates({
      gaps: [gap()],
      suppliers, orders, receptions, marketMedians,
      now: day('2026-03-01'),
      opts: { minSupplierScore: 50, leadTimeDays: 14 },
    });

    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c.type).toBe('crear_orden_compra');
    expect(c.supplier.name).toBe('Barato SA');
    expect(c.params.proveedor).toBe('Barato SA');
    expect(c.params.fecha).toBe('2026-03-01');
    expect(c.params.fechaEntrega).toBe('2026-03-15'); // +14 days
    expect(c.params.items).toHaveLength(1);
    expect(c.params.items[0].cantidad).toBe(100);
    expect(c.params.items[0].precioUnitario).toBe(80);
    expect(c.estimatedAmount).toBe(8000);
  });

  test('falls back to solicitud when no supplier clears minSupplierScore', () => {
    const suppliers = [{ id: 'S1', nombre: 'Unico SA' }];
    const orders = [
      { id: 'O1', proveedor: 'Unico SA', fecha: day('2026-02-01'),
        items: [item('P1', 1, 1000)] }, // way above market (no market here)
    ];
    const candidates = buildProcurementCandidates({
      gaps: [gap()],
      suppliers, orders, receptions: [], marketMedians: { P1: { median: 100 } },
      opts: { minSupplierScore: 80 },
    });
    expect(candidates[0].type).toBe('crear_solicitud_compra');
    expect(candidates[0].supplier).toBeNull();
    expect(candidates[0].params.items[0].cantidadSolicitada).toBe(100);
  });

  test('falls back to solicitud when no supplier has sold the product', () => {
    const suppliers = [{ id: 'S1', nombre: 'Vende Otra Cosa' }];
    const orders = [
      { id: 'O1', proveedor: 'Vende Otra Cosa', fecha: day('2026-02-01'),
        items: [item('P9', 1, 50)] },
    ];
    const candidates = buildProcurementCandidates({
      gaps: [gap({ productoId: 'P1' })],
      suppliers, orders, receptions: [], marketMedians: {},
    });
    expect(candidates[0].type).toBe('crear_solicitud_compra');
  });

  test('prioridad maps from urgency', () => {
    const suppliers = [];
    const gaps = [
      gap({ urgency: 'critical' }),
      gap({ urgency: 'low' }),
    ];
    const candidates = buildProcurementCandidates({
      gaps, suppliers, orders: [], receptions: [], marketMedians: {},
    });
    expect(candidates[0].prioridad).toBe('alta');
    expect(candidates[1].prioridad).toBe('baja');
  });

  test('skips gaps without a productoId', () => {
    const candidates = buildProcurementCandidates({
      gaps: [gap({ productoId: null })],
      suppliers: [], orders: [], receptions: [], marketMedians: {},
    });
    expect(candidates).toEqual([]);
  });

  test('URGENCY_TO_PRIORITY is stable', () => {
    expect(URGENCY_TO_PRIORITY).toEqual({
      critical: 'alta',
      high: 'alta',
      medium: 'media',
      low: 'baja',
    });
  });
});
