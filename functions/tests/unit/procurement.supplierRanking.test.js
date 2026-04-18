// Unit tests for the pure supplier ranking. Pure.

const { rankSuppliers } = require('../../lib/procurement/supplierRanking');
const { marketMedianByProduct } = require('../../lib/procurement/supplierPriceStats');

const day = (iso) => new Date(iso + 'T12:00:00Z');
const item = (productoId, cantidad, precioUnitario) => ({
  productoId, cantidad, precioUnitario, moneda: 'USD', unidad: 'L',
});

describe('rankSuppliers', () => {
  test('sorts scored suppliers high → low and puts nulls last', () => {
    const suppliers = [
      { id: 'S1', nombre: 'Caro SA' },
      { id: 'S2', nombre: 'Barato SA' },
      { id: 'S3', nombre: 'Nuevo SA' }, // no history → score null
    ];
    const orders = [
      { id: 'O1', proveedor: 'Caro SA', fecha: day('2026-01-01'),
        items: [item('P1', 1, 150)] },
      { id: 'O2', proveedor: 'Barato SA', fecha: day('2026-01-01'),
        items: [item('P1', 1, 80)] },
    ];
    const marketMedians = marketMedianByProduct(orders);
    const rows = rankSuppliers({ suppliers, orders, receptions: [], marketMedians });

    expect(rows.map(r => r.supplierId)).toEqual(['S2', 'S1', 'S3']);
    expect(rows[2].score).toBeNull();
  });

  test('filters to suppliers that have sold productoId when set', () => {
    const suppliers = [
      { id: 'S1', nombre: 'Vende P1' },
      { id: 'S2', nombre: 'Vende P2' },
    ];
    const orders = [
      { id: 'O1', proveedor: 'Vende P1', fecha: day('2026-01-01'),
        items: [item('P1', 1, 100)] },
      { id: 'O2', proveedor: 'Vende P2', fecha: day('2026-01-01'),
        items: [item('P2', 1, 100)] },
    ];
    const marketMedians = marketMedianByProduct(orders);
    const rows = rankSuppliers({
      suppliers, orders, receptions: [], marketMedians,
      opts: { productoId: 'P1' },
    });
    expect(rows.map(r => r.supplierId)).toEqual(['S1']);
    expect(rows[0].priceForProduct).toMatchObject({ avgPrice: 100 });
  });

  test('skips inactive suppliers and those without a name', () => {
    const suppliers = [
      { id: 'S1', nombre: 'Activo' },
      { id: 'S2', nombre: 'Inactivo', estado: 'inactivo' },
      { id: 'S3', nombre: '' },
      { id: 'S4' },
    ];
    const rows = rankSuppliers({
      suppliers, orders: [], receptions: [], marketMedians: {},
    });
    expect(rows.map(r => r.supplierId)).toEqual(['S1']);
  });

  test('empty input returns empty array', () => {
    expect(rankSuppliers({
      suppliers: [], orders: [], receptions: [], marketMedians: {},
    })).toEqual([]);
  });
});
