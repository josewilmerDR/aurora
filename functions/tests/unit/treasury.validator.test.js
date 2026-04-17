// Unit tests for cash_balance validator. Pure.

const { buildCashBalanceDoc } = require('../../routes/treasury/validator');

describe('buildCashBalanceDoc', () => {
  test('accepts minimal valid payload', () => {
    const { data, error } = buildCashBalanceDoc({ dateAsOf: '2026-04-17', amount: 10000 });
    expect(error).toBeUndefined();
    expect(data.dateAsOf).toBe('2026-04-17');
    expect(data.amount).toBe(10000);
    expect(data.currency).toBe('USD');
    expect(data.source).toBe('manual');
  });

  test('requires valid dateAsOf', () => {
    expect(buildCashBalanceDoc({ amount: 100 }).error).toMatch(/dateAsOf/i);
    expect(buildCashBalanceDoc({ dateAsOf: '2026-02-30', amount: 100 }).error).toMatch(/dateAsOf/i);
    expect(buildCashBalanceDoc({ dateAsOf: '17-04-2026', amount: 100 }).error).toMatch(/dateAsOf/i);
  });

  test('accepts negative amount (sobregiro)', () => {
    const { data, error } = buildCashBalanceDoc({ dateAsOf: '2026-04-17', amount: -500 });
    expect(error).toBeUndefined();
    expect(data.amount).toBe(-500);
  });

  test('rejects non-numeric amount', () => {
    expect(buildCashBalanceDoc({ dateAsOf: '2026-04-17', amount: 'abc' }).error).toMatch(/amount/i);
    expect(buildCashBalanceDoc({ dateAsOf: '2026-04-17' }).error).toMatch(/amount/i);
  });

  test('unknown source falls back to manual', () => {
    const { data } = buildCashBalanceDoc({ dateAsOf: '2026-04-17', amount: 100, source: 'alien' });
    expect(data.source).toBe('manual');
  });

  test('accepts bank source', () => {
    const { data } = buildCashBalanceDoc({ dateAsOf: '2026-04-17', amount: 100, source: 'bank' });
    expect(data.source).toBe('bank');
  });

  test('note is capped', () => {
    const { data } = buildCashBalanceDoc({
      dateAsOf: '2026-04-17',
      amount: 100,
      note: 'a'.repeat(1000),
    });
    expect(data.note.length).toBe(500);
  });
});
