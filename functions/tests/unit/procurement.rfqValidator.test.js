// Unit tests for RFQ validator. Pure.

const { buildRfqDoc, MAX_SUPPLIERS } = require('../../lib/procurement/rfqValidator');

// Deadline is picked far in the future so tests don't break on calendar day rollover.
const FUTURE = '2099-12-31';

const valid = (overrides = {}) => ({
  productoId: 'P1',
  nombreComercial: 'Urea 46%',
  cantidad: 100,
  unidad: 'kg',
  deadline: FUTURE,
  supplierIds: ['S1', 'S2'],
  ...overrides,
});

describe('buildRfqDoc', () => {
  test('accepts a fully valid body and defaults currency to USD', () => {
    const out = buildRfqDoc(valid());
    expect(out.error).toBeUndefined();
    expect(out.data).toMatchObject({
      productoId: 'P1',
      cantidad: 100,
      unidad: 'kg',
      currency: 'USD',
      maxLeadTimeDays: null,
    });
    expect(out.data.supplierIds).toEqual(['S1', 'S2']);
  });

  test('rejects missing productoId', () => {
    const out = buildRfqDoc({ ...valid(), productoId: '' });
    expect(out.error).toMatch(/productoId/);
  });

  test('rejects non-positive cantidad', () => {
    expect(buildRfqDoc({ ...valid(), cantidad: 0 }).error).toMatch(/cantidad/);
    expect(buildRfqDoc({ ...valid(), cantidad: -5 }).error).toMatch(/cantidad/);
    expect(buildRfqDoc({ ...valid(), cantidad: 'abc' }).error).toMatch(/cantidad/);
  });

  test('rejects missing unidad', () => {
    expect(buildRfqDoc({ ...valid(), unidad: '' }).error).toMatch(/unidad/);
  });

  test('rejects malformed deadline', () => {
    expect(buildRfqDoc({ ...valid(), deadline: '2026/04/20' }).error).toMatch(/deadline/);
    expect(buildRfqDoc({ ...valid(), deadline: 'not-a-date' }).error).toMatch(/deadline/);
  });

  test('rejects a past deadline', () => {
    expect(buildRfqDoc({ ...valid(), deadline: '2000-01-01' }).error).toMatch(/past/);
  });

  test('requires at least one supplierId', () => {
    expect(buildRfqDoc({ ...valid(), supplierIds: [] }).error).toMatch(/supplierId/);
    expect(buildRfqDoc({ ...valid(), supplierIds: null }).error).toMatch(/supplierId/);
  });

  test('caps supplierIds at MAX_SUPPLIERS', () => {
    const many = Array.from({ length: MAX_SUPPLIERS + 1 }, (_, i) => `S${i}`);
    expect(buildRfqDoc({ ...valid(), supplierIds: many }).error).toMatch(/At most/);
  });

  test('trims whitespace and drops non-strings from supplierIds', () => {
    const out = buildRfqDoc({
      ...valid(),
      supplierIds: [' S1 ', '', null, 'S2', 42],
    });
    expect(out.data.supplierIds).toEqual(['S1', 'S2']);
  });

  test('accepts maxLeadTimeDays and currency overrides', () => {
    const out = buildRfqDoc({ ...valid(), currency: 'CRC', maxLeadTimeDays: 10 });
    expect(out.data.currency).toBe('CRC');
    expect(out.data.maxLeadTimeDays).toBe(10);
  });

  test('ignores invalid maxLeadTimeDays', () => {
    expect(buildRfqDoc({ ...valid(), maxLeadTimeDays: -5 }).data.maxLeadTimeDays).toBeNull();
    expect(buildRfqDoc({ ...valid(), maxLeadTimeDays: 'abc' }).data.maxLeadTimeDays).toBeNull();
  });
});
