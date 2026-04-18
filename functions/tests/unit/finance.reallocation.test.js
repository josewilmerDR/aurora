// Unit tests for budget reallocation validator. Pure.

const { validateReallocation } = require('../../lib/finance/budgetReallocation');

const base = {
  source: { id: 'b1', fincaId: 'F1', period: '2026-04', category: 'combustible', assignedAmount: 1000 },
  target: { id: 'b2', fincaId: 'F1', period: '2026-04', category: 'insumos',     assignedAmount: 500 },
};

describe('validateReallocation', () => {
  test('happy path — computes new amounts', () => {
    const out = validateReallocation({ ...base, amount: 200 });
    expect(out.ok).toBe(true);
    expect(out.newSourceAmount).toBe(800);
    expect(out.newTargetAmount).toBe(700);
  });

  test('rejects same budget', () => {
    const out = validateReallocation({
      amount: 100,
      source: base.source,
      target: { ...base.source },
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/different budgets/i);
  });

  test('rejects different fincas', () => {
    const out = validateReallocation({
      amount: 100,
      source: base.source,
      target: { ...base.target, fincaId: 'F2' },
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/same finca/i);
  });

  test('rejects different periods', () => {
    const out = validateReallocation({
      amount: 100,
      source: base.source,
      target: { ...base.target, period: '2026-05' },
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/same period/i);
  });

  test('rejects same category', () => {
    const out = validateReallocation({
      amount: 100,
      source: base.source,
      target: { ...base.target, category: 'combustible' },
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/different categories/i);
  });

  test('rejects zero / negative / non-numeric amounts', () => {
    expect(validateReallocation({ ...base, amount: 0 }).ok).toBe(false);
    expect(validateReallocation({ ...base, amount: -10 }).ok).toBe(false);
    expect(validateReallocation({ ...base, amount: 'abc' }).ok).toBe(false);
  });

  test('rejects overdraft (source < amount)', () => {
    const out = validateReallocation({ ...base, amount: 1500 });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/only 1000/);
  });

  test('rejects missing source or target', () => {
    expect(validateReallocation({ amount: 100 }).ok).toBe(false);
    expect(validateReallocation({ amount: 100, source: base.source }).ok).toBe(false);
  });

  test('rounds new amounts to 2 decimals', () => {
    const out = validateReallocation({
      amount: 100.333,
      source: { ...base.source, assignedAmount: 500.111 },
      target: base.target,
    });
    expect(out.ok).toBe(true);
    expect(out.newSourceAmount).toBe(399.78); // 500.111 - 100.333
    expect(out.newTargetAmount).toBe(600.33); // 500 + 100.333
  });
});
