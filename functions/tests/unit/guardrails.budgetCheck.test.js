// Unit tests for budget cap and blocked category checks. Pure.

const {
  checkBudgetCap,
  checkBlockedCategory,
} = require('../../lib/finance/budgetGuardCheck');

describe('checkBudgetCap', () => {
  test('passes when proposed amount keeps projection under cap', () => {
    const out = checkBudgetCap({
      proposedAmount: 200,
      assigned: 1000,
      executed: 500,
      maxConsumptionPct: 100,
      category: 'combustible',
    });
    expect(out.ok).toBe(true);
  });

  test('blocks when projected execution exceeds 100% cap', () => {
    const out = checkBudgetCap({
      proposedAmount: 600,
      assigned: 1000,
      executed: 500,
      maxConsumptionPct: 100,
      category: 'insumos',
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/excediendo/i);
    expect(out.reason).toMatch(/insumos/);
  });

  test('permissive when no budget assigned', () => {
    // No hay budget → el check es permisivo (usar blockedBudgetCategories
    // para bloquear sin budget).
    const out = checkBudgetCap({
      proposedAmount: 5000,
      assigned: 0,
      executed: 0,
      maxConsumptionPct: 100,
    });
    expect(out.ok).toBe(true);
  });

  test('non-positive proposedAmount is a no-op', () => {
    expect(checkBudgetCap({ proposedAmount: 0, assigned: 100, executed: 0 }).ok).toBe(true);
    expect(checkBudgetCap({ proposedAmount: -50, assigned: 100, executed: 0 }).ok).toBe(true);
    expect(checkBudgetCap({ proposedAmount: 'abc', assigned: 100, executed: 0 }).ok).toBe(true);
  });

  test('custom cap below 100 — allows partial consumption only', () => {
    const out = checkBudgetCap({
      proposedAmount: 200,
      assigned: 1000,
      executed: 600,
      maxConsumptionPct: 75, // max: 750
      category: 'combustible',
    });
    expect(out.ok).toBe(false); // 600 + 200 = 800 > 750
  });

  test('cap above 100 — tolerates small overruns', () => {
    const out = checkBudgetCap({
      proposedAmount: 100,
      assigned: 1000,
      executed: 950,
      maxConsumptionPct: 110, // max: 1100
      category: 'combustible',
    });
    expect(out.ok).toBe(true); // 950 + 100 = 1050 ≤ 1100
  });

  test('defaults cap to 100 when maxConsumptionPct is null', () => {
    const out = checkBudgetCap({
      proposedAmount: 600,
      assigned: 1000,
      executed: 500,
      maxConsumptionPct: null, // → 100
    });
    expect(out.ok).toBe(false); // 1100 > 1000
  });

  test('missing executed treated as 0', () => {
    const out = checkBudgetCap({
      proposedAmount: 900,
      assigned: 1000,
      executed: undefined,
      maxConsumptionPct: 100,
    });
    expect(out.ok).toBe(true); // 900 ≤ 1000
  });

  test('reason mentions currency when provided', () => {
    const out = checkBudgetCap({
      proposedAmount: 2000,
      assigned: 1000,
      executed: 0,
      maxConsumptionPct: 100,
      currency: 'CRC',
      category: 'otro',
    });
    expect(out.reason).toMatch(/CRC/);
  });
});

describe('checkBlockedCategory', () => {
  test('passes when category is not in block list', () => {
    expect(checkBlockedCategory('insumos', ['otro']).ok).toBe(true);
  });

  test('blocks when category is in list', () => {
    const out = checkBlockedCategory('otro', ['otro', 'administrativo']);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/bloqueada/i);
  });

  test('passes when category is null (nothing to check)', () => {
    expect(checkBlockedCategory(null, ['otro']).ok).toBe(true);
  });

  test('passes when list is empty or missing', () => {
    expect(checkBlockedCategory('otro', []).ok).toBe(true);
    expect(checkBlockedCategory('otro', null).ok).toBe(true);
    expect(checkBlockedCategory('otro', undefined).ok).toBe(true);
  });
});
