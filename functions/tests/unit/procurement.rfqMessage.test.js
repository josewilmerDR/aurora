// Unit tests for the RFQ message builder. Pure.

const { buildRfqMessage, MAX_MESSAGE } = require('../../lib/procurement/rfqMessage');

describe('buildRfqMessage', () => {
  test('includes supplier name, product, quantity and deadline', () => {
    const msg = buildRfqMessage({
      supplierName: 'Agro Insumos SA',
      fincaName: 'Finca Aurora',
      productName: 'Urea 46%',
      cantidad: 100,
      unidad: 'kg',
      deadline: '2026-04-25',
    });
    expect(msg).toMatch(/Hola Agro Insumos SA/);
    expect(msg).toMatch(/Finca Aurora/);
    expect(msg).toMatch(/Urea 46%/);
    expect(msg).toMatch(/100 kg/);
    expect(msg).toMatch(/2026-04-25/);
    expect(msg).toMatch(/precio unitario/);
  });

  test('omits the deadline line when deadline is missing', () => {
    const msg = buildRfqMessage({ productName: 'X', cantidad: 1, unidad: 'L' });
    expect(msg).not.toMatch(/Respuesta antes/);
  });

  test('formats decimals cleanly', () => {
    const msg = buildRfqMessage({ productName: 'X', cantidad: 12.5, unidad: 'kg' });
    expect(msg).toMatch(/12\.5 kg/);
  });

  test('ref line included when rfqId is provided', () => {
    const msg = buildRfqMessage({ productName: 'X', cantidad: 1, unidad: 'L', rfqId: 'abc123' });
    expect(msg).toMatch(/Ref: abc123/);
  });

  test('truncates excessively long inputs', () => {
    const long = 'x'.repeat(5000);
    const msg = buildRfqMessage({
      supplierName: long,
      productName: long,
      notas: long,
      cantidad: 1,
      unidad: 'L',
    });
    expect(msg.length).toBeLessThanOrEqual(MAX_MESSAGE);
  });

  test('handles missing product name gracefully', () => {
    const msg = buildRfqMessage({ cantidad: 10, unidad: 'kg' });
    expect(msg).toMatch(/\(sin nombre\)/);
  });

  test('greeting is generic when supplierName is not set', () => {
    const msg = buildRfqMessage({ productName: 'X', cantidad: 1, unidad: 'L' });
    expect(msg.startsWith('Hola,')).toBe(true);
  });
});
