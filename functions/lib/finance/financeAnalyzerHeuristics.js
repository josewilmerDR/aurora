// Heurísticas puras para proponer reasignaciones de presupuesto.
// Sin Firestore — recibe ejecución y budgets ya resueltos.
//
// Versión v1: reglas deterministas simples. La integración con Claude para
// razonamiento narrativo vive fuera (v2). Estas heurísticas son el "paso
// cero" que detecta situaciones objetivas que ameritan una reasignación.

// Umbrales por defecto — sobrescribibles por config.
const DEFAULTS = Object.freeze({
  overBudgetPctThreshold: 90,    // categoría ≥ 90% consumida → "en riesgo"
  underBudgetPctThreshold: 50,   // categoría < 50% consumida → "holgada"
  minTransferAmount: 100,        // no proponer reasignaciones menores a este monto
  // Para evitar sugerencias obvias, requerimos que el residual de source
  // sea al menos este monto tras la reasignación (la fuente "sobra" pero
  // no se queda pelada).
  minSourceBufferAfter: 50,
});

// Input:
//   executionRows: array de filas con { category, assignedAmount, executedAmount, percentConsumed }
//                  (salida de /api/budgets/execution)
//   budgetsByCategory: { [category]: [budgetDoc...] } — los budgets concretos
//                  por categoría para el período (sumable para multi-budget
//                  en la misma categoría).
//   opts: override de umbrales.
//
// Output: array de recomendaciones { fromCategory, toCategory, amount, reason }
// Cada recomendación es una sugerencia abstracta (por categoría). El
// ejecutor concreto decide qué budget doc específico usar como source/target
// cuando hay más de uno por categoría.
function findReallocationCandidates(executionRows, budgetsByCategory, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const rows = Array.isArray(executionRows) ? executionRows : [];

  // Particionamos las categorías con budget asignado.
  const overBudget = [];
  const underBudget = [];
  for (const r of rows) {
    if (!r || !r.category) continue;
    const assigned = Number(r.assignedAmount) || 0;
    if (assigned <= 0) continue;
    const pct = Number(r.percentConsumed);
    if (!Number.isFinite(pct)) continue;
    if (pct >= cfg.overBudgetPctThreshold) overBudget.push(r);
    else if (pct < cfg.underBudgetPctThreshold) underBudget.push(r);
  }

  // Ordenamos over-budget por más crítico primero (mayor %),
  // under-budget por más holgado primero (menor %).
  overBudget.sort((a, b) => (b.percentConsumed || 0) - (a.percentConsumed || 0));
  underBudget.sort((a, b) => (a.percentConsumed || 0) - (b.percentConsumed || 0));

  const suggestions = [];
  const usedSources = new Set();

  for (const over of overBudget) {
    // Monto faltante conservador: llevar la ejecución proyectada al 100%.
    const shortfall = round2(Math.max(0, (over.executedAmount || 0) - (over.assignedAmount || 0)));
    if (shortfall < cfg.minTransferAmount) continue;

    // Buscamos un source que no haya sido ya asignado a otra reasignación.
    for (const under of underBudget) {
      if (usedSources.has(under.category)) continue;

      // Monto disponible en el holgado: lo "no consumido" menos el buffer.
      const slack = round2(Math.max(0, (under.assignedAmount || 0) - (under.executedAmount || 0) - cfg.minSourceBufferAfter));
      if (slack < cfg.minTransferAmount) continue;

      const amount = round2(Math.min(shortfall, slack));
      if (amount < cfg.minTransferAmount) continue;

      // Validamos que haya al menos un budget doc en ambas categorías —
      // sin eso no hay cómo ejecutar.
      const sourceBudgets = budgetsByCategory[under.category] || [];
      const targetBudgets = budgetsByCategory[over.category] || [];
      if (sourceBudgets.length === 0 || targetBudgets.length === 0) continue;

      suggestions.push({
        fromCategory: under.category,
        toCategory: over.category,
        amount,
        reason: `Categoría "${over.category}" consumida al ${(over.percentConsumed || 0).toFixed(0)}%; "${under.category}" al ${(under.percentConsumed || 0).toFixed(0)}%. Sugiero transferir ${amount} para cubrir el déficit proyectado.`,
      });
      usedSources.add(under.category);
      break; // un source por over-budget para no canibalizar
    }
  }

  return suggestions;
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

module.exports = {
  findReallocationCandidates,
  DEFAULTS,
};
