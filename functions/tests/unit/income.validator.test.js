// Unit tests for income validator. Pure — no Firestore.

const { buildIncomeDoc, isValidISODate } = require('../../routes/income/validator');

const baseValid = {
  date: '2026-04-17',
  buyerId: 'buyer-1',
  quantity: 100,
  unitPrice: 2.5,
};

describe('isValidISODate', () => {
  test('accepts real dates', () => {
    expect(isValidISODate('2026-04-17')).toBe(true);
  });
  test('rejects fake dates that new Date() would normalize', () => {
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
  });
  test('rejects wrong format', () => {
    expect(isValidISODate('17/04/2026')).toBe(false);
    expect(isValidISODate('')).toBe(false);
    expect(isValidISODate(null)).toBe(false);
  });
});

describe('buildIncomeDoc', () => {
  test('requires valid date', () => {
    expect(buildIncomeDoc({ ...baseValid, date: '2026/04/17' }).error).toMatch(/date is required/i);
    expect(buildIncomeDoc({ ...baseValid, date: '2026-02-30' }).error).toMatch(/date is required/i);
  });

  test('requires buyerId', () => {
    const { error } = buildIncomeDoc({ ...baseValid, buyerId: '' }, { buyerName: '' });
    expect(error).toMatch(/buyer is required/i);
  });

  test('requires positive quantity', () => {
    expect(buildIncomeDoc({ ...baseValid, quantity: 0 }).error).toMatch(/quantity/i);
    expect(buildIncomeDoc({ ...baseValid, quantity: -1 }).error).toMatch(/quantity/i);
  });

  test('requires non-negative unitPrice', () => {
    expect(buildIncomeDoc({ ...baseValid, unitPrice: undefined }).error).toMatch(/unit price/i);
    expect(buildIncomeDoc({ ...baseValid, unitPrice: -5 }).error).toMatch(/unit price/i);
  });

  test('computes totalAmount when not provided', () => {
    const { data } = buildIncomeDoc(baseValid, { buyerName: 'B' });
    expect(data.totalAmount).toBeCloseTo(250);
  });

  test('respects explicit totalAmount (e.g. discounts)', () => {
    const { data } = buildIncomeDoc({ ...baseValid, totalAmount: 225 }, { buyerName: 'B' });
    expect(data.totalAmount).toBe(225);
  });

  test('defaults currency to USD', () => {
    expect(buildIncomeDoc(baseValid, { buyerName: 'B' }).data.currency).toBe('USD');
  });

  test('accepts CRC currency', () => {
    expect(buildIncomeDoc({ ...baseValid, currency: 'CRC' }, { buyerName: 'B' }).data.currency).toBe('CRC');
  });

  test('defaults collectionStatus to pendiente', () => {
    expect(buildIncomeDoc(baseValid, { buyerName: 'B' }).data.collectionStatus).toBe('pendiente');
  });

  test('cobrado requires actualCollectionDate', () => {
    const { error } = buildIncomeDoc(
      { ...baseValid, collectionStatus: 'cobrado' },
      { buyerName: 'B' }
    );
    expect(error).toMatch(/actual collection date is required/i);
  });

  test('cobrado with valid actualCollectionDate succeeds', () => {
    const { data, error } = buildIncomeDoc(
      { ...baseValid, collectionStatus: 'cobrado', actualCollectionDate: '2026-04-20' },
      { buyerName: 'B' }
    );
    expect(error).toBeUndefined();
    expect(data.collectionStatus).toBe('cobrado');
    expect(data.actualCollectionDate).toBe('2026-04-20');
  });

  test('rejects invalid expectedCollectionDate', () => {
    const { error } = buildIncomeDoc(
      { ...baseValid, expectedCollectionDate: '2026-13-01' },
      { buyerName: 'B' }
    );
    expect(error).toMatch(/expected collection date/i);
  });

  test('buyerName is persisted from handler-resolved value', () => {
    const { data } = buildIncomeDoc(baseValid, { buyerName: 'Acme Exports' });
    expect(data.buyerName).toBe('Acme Exports');
  });

  test('optional linkage fields default to null', () => {
    const { data } = buildIncomeDoc(baseValid, { buyerName: 'B' });
    expect(data.loteId).toBeNull();
    expect(data.despachoId).toBeNull();
    expect(data.cosechaRegistroId).toBeNull();
  });

  test('optional linkage fields pass through when provided', () => {
    const { data } = buildIncomeDoc(
      { ...baseValid, loteId: 'lote-9', despachoId: 'dc-1' },
      { buyerName: 'B' }
    );
    expect(data.loteId).toBe('lote-9');
    expect(data.despachoId).toBe('dc-1');
  });
});
