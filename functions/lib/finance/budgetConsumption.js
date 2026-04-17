// Merge puro entre budgets asignados y totales de costos ejecutados.
// Sin Firestore. Testeable de forma aislada.

const { BUDGET_CATEGORIES } = require('./categories');

// Suma los montos asignados por categoría (varios budgets pueden apuntar a la
// misma categoría, por ejemplo uno global + uno por lote).
function sumAssignedByCategory(budgets) {
  const out = {};
  for (const b of budgets) {
    const c = b.category;
    if (!c) continue;
    out[c] = (out[c] || 0) + (Number(b.assignedAmount) || 0);
  }
  return out;
}

// Construye el reporte de ejecución. Entrada:
//   - budgets: array de docs de budget (con assignedAmount, category)
//   - periodCosts: { category: amount } — ver periodCosts.js
// Salida: array de filas { category, assignedAmount, executedAmount, remaining,
//   percentConsumed, overBudget }. Incluye categorías con budget=0 y gasto>0
//   para que la UI las destaque.
function buildExecutionReport(budgets, periodCosts) {
  const assigned = sumAssignedByCategory(budgets);

  // Unimos las categorías conocidas y las que aparezcan en cualquiera de los
  // dos lados para no perder datos.
  const seen = new Set([
    ...BUDGET_CATEGORIES,
    ...Object.keys(assigned),
    ...Object.keys(periodCosts || {}),
  ]);

  const rows = [];
  for (const category of seen) {
    const assignedAmount = round2(assigned[category] || 0);
    const executedAmount = round2(Number(periodCosts?.[category]) || 0);
    const remaining = round2(assignedAmount - executedAmount);
    const percentConsumed = assignedAmount > 0
      ? round2((executedAmount / assignedAmount) * 100)
      : null; // null = "sin budget asignado" (no es 0% ni ∞%)
    rows.push({
      category,
      assignedAmount,
      executedAmount,
      remaining,
      percentConsumed,
      overBudget: assignedAmount > 0 && executedAmount > assignedAmount,
    });
  }

  // Orden estable: primero las categorías canónicas en su orden, luego las
  // inesperadas (ordenadas alfabéticamente).
  rows.sort((a, b) => {
    const ia = BUDGET_CATEGORIES.indexOf(a.category);
    const ib = BUDGET_CATEGORIES.indexOf(b.category);
    if (ia === -1 && ib === -1) return a.category.localeCompare(b.category);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return rows;
}

// Totales agregados sobre el reporte — útil para mostrar un "resumen global".
function summarizeExecution(rows) {
  let totalAssigned = 0;
  let totalExecuted = 0;
  for (const r of rows) {
    totalAssigned += r.assignedAmount;
    totalExecuted += r.executedAmount;
  }
  return {
    totalAssigned: round2(totalAssigned),
    totalExecuted: round2(totalExecuted),
    totalRemaining: round2(totalAssigned - totalExecuted),
    percentConsumed: totalAssigned > 0
      ? round2((totalExecuted / totalAssigned) * 100)
      : null,
  };
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

module.exports = {
  buildExecutionReport,
  summarizeExecution,
  sumAssignedByCategory,
};
