// Unit tests for buyers validator. Pure — no Firestore.

const { buildBuyerDoc } = require('../../routes/buyers/validator');

describe('buildBuyerDoc', () => {
  test('requires name', () => {
    expect(buildBuyerDoc({}).error).toMatch(/name is required/i);
    expect(buildBuyerDoc({ name: '   ' }).error).toMatch(/name is required/i);
  });

  test('accepts minimal valid payload and applies defaults', () => {
    const { data, error } = buildBuyerDoc({ name: 'Fruit Export Co.' });
    expect(error).toBeUndefined();
    expect(data.name).toBe('Fruit Export Co.');
    expect(data.paymentType).toBe('contado');
    expect(data.currency).toBe('USD');
    expect(data.status).toBe('activo');
    expect(data.creditDays).toBeNull();
  });

  test('trims and caps long strings', () => {
    const veryLong = 'a'.repeat(3000);
    const { data } = buildBuyerDoc({ name: veryLong, notes: veryLong });
    expect(data.name.length).toBe(150);
    expect(data.notes.length).toBe(2000);
  });

  test('rejects malformed email, accepts empty', () => {
    expect(buildBuyerDoc({ name: 'X', email: 'not-an-email' }).error).toMatch(/email/i);
    const { data } = buildBuyerDoc({ name: 'X', email: '' });
    expect(data.email).toBe('');
  });

  test('credit payment type defaults creditDays to 30', () => {
    const { data } = buildBuyerDoc({ name: 'X', paymentType: 'credito' });
    expect(data.creditDays).toBe(30);
  });

  test('credit payment type respects custom creditDays within range', () => {
    const { data } = buildBuyerDoc({ name: 'X', paymentType: 'credito', creditDays: 60 });
    expect(data.creditDays).toBe(60);
  });

  test('credit payment type rejects out-of-range creditDays and falls back to 30', () => {
    const { data } = buildBuyerDoc({ name: 'X', paymentType: 'credito', creditDays: 99999 });
    expect(data.creditDays).toBe(30);
  });

  test('unknown payment type falls back to contado', () => {
    const { data } = buildBuyerDoc({ name: 'X', paymentType: 'trueque' });
    expect(data.paymentType).toBe('contado');
  });

  test('unknown currency falls back to USD', () => {
    const { data } = buildBuyerDoc({ name: 'X', currency: 'EUR' });
    expect(data.currency).toBe('USD');
  });

  test('accepts known currencies', () => {
    expect(buildBuyerDoc({ name: 'X', currency: 'CRC' }).data.currency).toBe('CRC');
  });

  test('creditLimit accepts numbers, rejects negatives', () => {
    expect(buildBuyerDoc({ name: 'X', creditLimit: 5000 }).data.creditLimit).toBe(5000);
    expect(buildBuyerDoc({ name: 'X', creditLimit: -1 }).data.creditLimit).toBeNull();
  });
});
