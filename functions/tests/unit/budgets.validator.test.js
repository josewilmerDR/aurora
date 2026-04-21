// Unit tests for budget validator. Pure — no Firestore.

const { buildBudgetDoc } = require('../../routes/budgets/validator');

const base = {
  period: '2026-04',
  category: 'combustible',
  assignedAmount: 1000,
};

describe('buildBudgetDoc', () => {
  test('accepts minimal valid payload', () => {
    const { data, error } = buildBudgetDoc(base);
    expect(error).toBeUndefined();
    expect(data.period).toBe('2026-04');
    expect(data.category).toBe('combustible');
    expect(data.assignedAmount).toBe(1000);
    expect(data.currency).toBe('CRC');
    expect(data.loteId).toBeNull();
    expect(data.grupoId).toBeNull();
  });

  test('rejects invalid period', () => {
    expect(buildBudgetDoc({ ...base, period: '2026-13' }).error).toMatch(/period must be/i);
    expect(buildBudgetDoc({ ...base, period: '2026/04' }).error).toMatch(/period must be/i);
    expect(buildBudgetDoc({ ...base, period: '' }).error).toMatch(/period must be/i);
  });

  test('accepts year, quarter, month periods', () => {
    expect(buildBudgetDoc({ ...base, period: '2026' }).error).toBeUndefined();
    expect(buildBudgetDoc({ ...base, period: '2026-Q3' }).error).toBeUndefined();
    expect(buildBudgetDoc({ ...base, period: '2026-04' }).error).toBeUndefined();
  });

  test('rejects unknown category', () => {
    expect(buildBudgetDoc({ ...base, category: 'viajes' }).error).toMatch(/category/i);
    expect(buildBudgetDoc({ ...base, category: '' }).error).toMatch(/category/i);
  });

  test('accepts all budget categories', () => {
    const cats = ['combustible', 'depreciacion', 'planilla_directa', 'planilla_fija', 'insumos', 'mantenimiento', 'administrativo', 'otro'];
    for (const c of cats) {
      const { error } = buildBudgetDoc({ ...base, category: c });
      expect(error).toBeUndefined();
    }
  });

  test('rejects negative or non-numeric assignedAmount', () => {
    expect(buildBudgetDoc({ ...base, assignedAmount: -1 }).error).toMatch(/assigned amount/i);
    expect(buildBudgetDoc({ ...base, assignedAmount: 'abc' }).error).toMatch(/assigned amount/i);
    expect(buildBudgetDoc({ ...base, assignedAmount: null }).error).toMatch(/assigned amount/i);
  });

  test('accepts zero assignedAmount (e.g. freeze a category)', () => {
    const { error, data } = buildBudgetDoc({ ...base, assignedAmount: 0 });
    expect(error).toBeUndefined();
    expect(data.assignedAmount).toBe(0);
  });

  test('unknown currency falls back to CRC', () => {
    expect(buildBudgetDoc({ ...base, currency: 'EUR' }).data.currency).toBe('CRC');
  });

  test('accepts CRC currency', () => {
    expect(buildBudgetDoc({ ...base, currency: 'CRC' }).data.currency).toBe('CRC');
  });

  test('CRC budget gets exchangeRateToCRC=1 and assignedAmountCRC=assignedAmount', () => {
    const { data } = buildBudgetDoc(base);
    expect(data.exchangeRateToCRC).toBe(1);
    expect(data.assignedAmountCRC).toBe(data.assignedAmount);
  });

  test('USD budget without exchangeRateToCRC is rejected', () => {
    const { error } = buildBudgetDoc({ ...base, currency: 'USD' });
    expect(error).toMatch(/exchangeRateToCRC/);
  });

  test('USD budget with exchangeRateToCRC computes assignedAmountCRC', () => {
    const { data, error } = buildBudgetDoc({
      ...base,
      currency: 'USD',
      exchangeRateToCRC: 520,
    });
    expect(error).toBeUndefined();
    expect(data.exchangeRateToCRC).toBe(520);
    expect(data.assignedAmountCRC).toBe(520000); // 1000 * 520
  });

  test('trims optional identifiers', () => {
    const { data } = buildBudgetDoc({ ...base, loteId: '  lote-1  ', grupoId: 'g-2' });
    expect(data.loteId).toBe('lote-1');
    expect(data.grupoId).toBe('g-2');
  });

  test('subcategory passes through', () => {
    const { data } = buildBudgetDoc({ ...base, subcategory: 'diesel' });
    expect(data.subcategory).toBe('diesel');
  });

  test('notes are capped', () => {
    const long = 'a'.repeat(2000);
    const { data } = buildBudgetDoc({ ...base, notes: long });
    expect(data.notes.length).toBe(1000);
  });
});
