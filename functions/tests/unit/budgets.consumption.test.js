// Unit tests for budget consumption logic. Pure — no Firestore.

const {
  buildExecutionReport,
  summarizeExecution,
  sumAssignedByCategory,
} = require('../../lib/finance/budgetConsumption');

describe('sumAssignedByCategory', () => {
  test('sums multiple budgets of same category', () => {
    const budgets = [
      { category: 'combustible', assignedAmount: 500 },
      { category: 'combustible', assignedAmount: 300 },
      { category: 'insumos', assignedAmount: 1000 },
    ];
    expect(sumAssignedByCategory(budgets)).toEqual({
      combustible: 800,
      insumos: 1000,
    });
  });

  test('ignores budgets without category', () => {
    const { combustible } = sumAssignedByCategory([
      { assignedAmount: 100 }, // no category → ignored
      { category: 'combustible', assignedAmount: 50 },
    ]);
    expect(combustible).toBe(50);
  });

  test('treats missing amount as zero', () => {
    const out = sumAssignedByCategory([{ category: 'insumos' }]);
    expect(out.insumos).toBe(0);
  });
});

describe('buildExecutionReport', () => {
  test('happy path — all canonical categories present', () => {
    const budgets = [
      { category: 'combustible', assignedAmount: 1000 },
      { category: 'insumos', assignedAmount: 500 },
    ];
    const periodCosts = {
      combustible: 400,
      depreciacion: 200,
      planilla_directa: 0,
      planilla_fija: 0,
      insumos: 600, // over budget
      mantenimiento: 0,
      administrativo: 0,
      otro: 0,
    };
    const rows = buildExecutionReport(budgets, periodCosts);

    const fuel = rows.find(r => r.category === 'combustible');
    expect(fuel.assignedAmount).toBe(1000);
    expect(fuel.executedAmount).toBe(400);
    expect(fuel.remaining).toBe(600);
    expect(fuel.percentConsumed).toBe(40);
    expect(fuel.overBudget).toBe(false);

    const insumos = rows.find(r => r.category === 'insumos');
    expect(insumos.executedAmount).toBe(600);
    expect(insumos.remaining).toBe(-100);
    expect(insumos.percentConsumed).toBe(120);
    expect(insumos.overBudget).toBe(true);
  });

  test('category with spend but no budget returns percentConsumed null', () => {
    const rows = buildExecutionReport([], { depreciacion: 150 });
    const dep = rows.find(r => r.category === 'depreciacion');
    expect(dep.assignedAmount).toBe(0);
    expect(dep.executedAmount).toBe(150);
    expect(dep.percentConsumed).toBeNull();
    expect(dep.overBudget).toBe(false); // no budget → no "over budget"
  });

  test('rows ordered by canonical category list', () => {
    const rows = buildExecutionReport([], {});
    const order = rows.map(r => r.category);
    expect(order[0]).toBe('combustible');
    expect(order[1]).toBe('depreciacion');
    expect(order[2]).toBe('planilla_directa');
  });

  test('unknown categories are sorted to the end', () => {
    const rows = buildExecutionReport(
      [{ category: 'zzz_unknown', assignedAmount: 100 }],
      {}
    );
    expect(rows[rows.length - 1].category).toBe('zzz_unknown');
  });

  test('amounts are rounded to 2 decimals', () => {
    const rows = buildExecutionReport(
      [{ category: 'combustible', assignedAmount: 100 }],
      { combustible: 33.333 }
    );
    const fuel = rows.find(r => r.category === 'combustible');
    expect(fuel.executedAmount).toBe(33.33);
    expect(fuel.percentConsumed).toBe(33.33);
  });
});

describe('summarizeExecution', () => {
  test('sums totals across rows', () => {
    const rows = [
      { assignedAmount: 1000, executedAmount: 400, category: 'a' },
      { assignedAmount: 500, executedAmount: 600, category: 'b' },
    ];
    const s = summarizeExecution(rows);
    expect(s.totalAssigned).toBe(1500);
    expect(s.totalExecuted).toBe(1000);
    expect(s.totalRemaining).toBe(500);
    expect(s.percentConsumed).toBeCloseTo(66.67, 1);
  });

  test('percentConsumed is null when nothing assigned', () => {
    const s = summarizeExecution([
      { assignedAmount: 0, executedAmount: 100, category: 'a' },
    ]);
    expect(s.percentConsumed).toBeNull();
  });
});
