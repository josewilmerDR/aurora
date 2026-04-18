// Validación pura de una propuesta de reasignación de presupuesto.
// Sin Firestore. Se usa tanto desde el validador del handler como desde el
// analizador heurístico.
//
// Invariantes:
//   - Ambos budgets existen (lo verifica el handler, no nosotros)
//   - Mismo fincaId y mismo period
//   - Categorías distintas (no sirve mover de A→A)
//   - amount > 0
//   - source.assignedAmount >= amount (no se puede prestar más de lo que hay)

function validateReallocation({ amount, source, target }) {
  if (!source || !target) {
    return { ok: false, reason: 'Source and target budgets are required.' };
  }
  if (source.id === target.id) {
    return { ok: false, reason: 'Source and target must be different budgets.' };
  }
  if (source.fincaId !== target.fincaId) {
    return { ok: false, reason: 'Budgets must belong to the same finca.' };
  }
  if (source.period !== target.period) {
    return { ok: false, reason: 'Budgets must belong to the same period.' };
  }
  if (source.category === target.category) {
    return { ok: false, reason: 'Source and target must be different categories.' };
  }

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, reason: 'Amount must be a positive number.' };
  }

  const sourceAssigned = Number(source.assignedAmount) || 0;
  if (sourceAssigned < amt) {
    return {
      ok: false,
      reason: `Source budget (${source.category}) has only ${sourceAssigned}; cannot transfer ${amt}.`,
    };
  }

  return {
    ok: true,
    newSourceAmount: round2(sourceAssigned - amt),
    newTargetAmount: round2((Number(target.assignedAmount) || 0) + amt),
  };
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

module.exports = { validateReallocation };
