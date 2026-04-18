// Firestore-facing inputs para el budget guard. Recupera:
//   1. Categoría del proveedor del OC (para mapear a budget category)
//   2. Budget asignado total para (finca, period, category)
//   3. Costo ejecutado para esa categoría en el período
//
// Separado de autopilotGuardrails.js y del chequeo puro para mantener cada
// archivo enfocado en una responsabilidad.

const { db } = require('../firebase');
const { periodToDateRange } = require('./periodRange');
const { computePeriodCosts } = require('./periodCosts');

// Formato YYYY-MM del mes actual en UTC. Sin dependencia de zona horaria
// del servidor (Cloud Functions corre en UTC por defecto).
function currentMonthPeriod(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// Obtiene el doc de proveedor por id. Devuelve null si no existe o si no
// pertenece a la finca.
async function fetchSupplier(fincaId, supplierId) {
  if (!supplierId) return null;
  const doc = await db.collection('proveedores').doc(supplierId).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.fincaId !== fincaId) return null;
  return { id: doc.id, ...data };
}

// Suma assignedAmount de todos los budgets que aplican a (finca, period, category).
async function fetchAssignedForCategory(fincaId, period, category) {
  const snap = await db.collection('budgets')
    .where('fincaId', '==', fincaId)
    .where('period', '==', period)
    .where('category', '==', category)
    .get();
  return snap.docs.reduce((sum, d) => sum + (Number(d.data().assignedAmount) || 0), 0);
}

// Calcula el costo ejecutado para una categoría específica en el período.
// Reutiliza computePeriodCosts (que corre todas las queries en paralelo) y
// simplemente extrae el campo solicitado.
async function fetchExecutedForCategory(fincaId, period, category) {
  const range = periodToDateRange(period);
  if (!range) return 0;
  const totals = await computePeriodCosts(fincaId, range);
  return Number(totals[category]) || 0;
}

// Acceso combinado — útil para el guardrail.
async function fetchBudgetGuardInputs(fincaId, { period, category }) {
  const [assigned, executed] = await Promise.all([
    fetchAssignedForCategory(fincaId, period, category),
    fetchExecutedForCategory(fincaId, period, category),
  ]);
  return { assigned, executed };
}

module.exports = {
  currentMonthPeriod,
  fetchSupplier,
  fetchAssignedForCategory,
  fetchExecutedForCategory,
  fetchBudgetGuardInputs,
};
