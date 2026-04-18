// Chequeo puro de cap presupuestal. Sin Firestore — recibe los totales ya
// resueltos. Decide si una acción propuesta viola un cap dado.

// Formato de retorno:
//   { ok: true }                          — pasa el check
//   { ok: false, reason: string }         — violación

// `maxConsumptionPct` es el tope relativo al monto asignado (ej: 100 = no
// exceder el 100% del budget). Si es null/undefined, el check es permisivo.
function checkBudgetCap({
  proposedAmount,
  assigned,
  executed,
  maxConsumptionPct,
  category,
  currency = 'USD',
}) {
  const amount = Number(proposedAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    // Acción sin monto relevante (ej: 0) — no hay nada que capear.
    return { ok: true };
  }

  const assignedNum = Number(assigned);
  if (!Number.isFinite(assignedNum) || assignedNum <= 0) {
    // No hay budget asignado para esta categoría. Política: permisiva por
    // defecto (no se puede exceder algo que no está definido). Si el usuario
    // quiere bloquear categorías sin budget, debe usar `blockedBudgetCategories`.
    return { ok: true };
  }

  const cap = Number.isFinite(Number(maxConsumptionPct))
    ? Number(maxConsumptionPct)
    : 100;

  const executedNum = Number.isFinite(Number(executed)) ? Number(executed) : 0;
  const projected = executedNum + amount;
  const maxAllowed = assignedNum * (cap / 100);

  if (projected > maxAllowed) {
    const fmt = (n) => `${currency} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    const catLabel = category ? `"${category}"` : 'presupuestal';
    return {
      ok: false,
      reason: `La acción (${fmt(amount)}) llevaría la categoría ${catLabel} a ${fmt(projected)}, excediendo el tope de ${cap}% (${fmt(maxAllowed)}) sobre el asignado (${fmt(assignedNum)}).`,
    };
  }

  return { ok: true };
}

// Chequeo de lista negra — categorías completamente bloqueadas para acciones
// autónomas, independientemente del budget.
function checkBlockedCategory(category, blockedCategories) {
  if (!category) return { ok: true };
  const list = Array.isArray(blockedCategories) ? blockedCategories : [];
  if (list.includes(category)) {
    return {
      ok: false,
      reason: `La categoría presupuestaria "${category}" está bloqueada para acciones autónomas.`,
    };
  }
  return { ok: true };
}

module.exports = {
  checkBudgetCap,
  checkBlockedCategory,
};
