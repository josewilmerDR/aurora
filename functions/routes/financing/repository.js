// Repositorio del dominio `financing`. Único archivo del dominio que toca
// db.collection(). Cubre cuatro colecciones de financing y una lectura
// cross-domain a `autopilot_config` (necesaria para la N1-policy del kill
// switch). Cuando hagamos F5 y se reorganice autopilot, esa lectura debería
// migrar a un helper compartido en `lib/autopilot/`.
//
// Sección por colección. Funciones nombradas como operaciones de negocio
// (listSnapshots, createEligibilityAnalysis...), no como mecánica Firestore.

const { db, FieldValue } = require('../../lib/firebase');

const COL_SNAPSHOTS = 'financial_profile_snapshots';
const COL_CREDIT_PRODUCTS = 'credit_products';
const COL_ELIGIBILITY = 'eligibility_analyses';
const COL_DEBT_SIMS = 'debt_simulations';
const COL_AUTOPILOT_CFG = 'autopilot_config';

const LIST_LIMIT = 50;

// ─── Snapshots (financial_profile_snapshots) ──────────────────────────────

async function createSnapshot(fincaId, actor, profile) {
  const docRef = await db.collection(COL_SNAPSHOTS).add({
    fincaId,
    generatedBy: actor.uid,
    generatedByEmail: actor.userEmail || '',
    generatedByRole: actor.userRole,
    generatedAt: FieldValue.serverTimestamp(),
    asOf: profile.asOf,
    historyRange: profile.historyRange,
    projectionRange: profile.projectionRange,
    balanceSheet: profile.balanceSheet,
    incomeStatement: profile.incomeStatement,
    cashFlow: profile.cashFlow,
    inputsHash: profile.inputsHash,
    sourceCounts: profile.sourceCounts,
  });
  return docRef.id;
}

async function listSnapshots(fincaId) {
  const snap = await db.collection(COL_SNAPSHOTS)
    .where('fincaId', '==', fincaId)
    .orderBy('generatedAt', 'desc')
    .limit(LIST_LIMIT)
    .get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

// ─── Credit products ──────────────────────────────────────────────────────

async function listCreditProducts(fincaId) {
  const snap = await db.collection(COL_CREDIT_PRODUCTS)
    .where('fincaId', '==', fincaId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Variante usada por el analizador de elegibilidad: sólo productos activos.
// Se filtra en memoria para evitar exigir un índice compuesto en Firestore;
// el catálogo es pequeño (decenas de productos por finca).
async function listActiveCreditProducts(fincaId) {
  const all = await listCreditProducts(fincaId);
  return all.filter((p) => p.activo !== false);
}

async function createCreditProduct(fincaId, actor, data) {
  const docRef = await db.collection(COL_CREDIT_PRODUCTS).add({
    ...data,
    fincaId,
    createdBy: actor.uid,
    createdByEmail: actor.userEmail || '',
    createdAt: FieldValue.serverTimestamp(),
  });
  return docRef.id;
}

async function updateCreditProduct(id, actor, data) {
  await db.collection(COL_CREDIT_PRODUCTS).doc(id).update({
    ...data,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function removeCreditProduct(id) {
  await db.collection(COL_CREDIT_PRODUCTS).doc(id).delete();
}

// ─── Eligibility analyses (append-only) ───────────────────────────────────

async function createEligibilityAnalysis(fincaId, actor, payload) {
  const docRef = await db.collection(COL_ELIGIBILITY).add({
    ...payload,
    fincaId,
    createdBy: actor.uid,
    createdByEmail: actor.userEmail || '',
    createdAt: FieldValue.serverTimestamp(),
  });
  return docRef.id;
}

async function listEligibilityAnalyses(fincaId) {
  const snap = await db.collection(COL_ELIGIBILITY)
    .where('fincaId', '==', fincaId)
    .orderBy('createdAt', 'desc')
    .limit(LIST_LIMIT)
    .get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

// ─── Debt simulations (append-only) ───────────────────────────────────────

async function createDebtSimulation(fincaId, actor, payload) {
  const docRef = await db.collection(COL_DEBT_SIMS).add({
    ...payload,
    fincaId,
    createdBy: actor.uid,
    createdByEmail: actor.userEmail || '',
    createdAt: FieldValue.serverTimestamp(),
  });
  return docRef.id;
}

async function listDebtSimulations(fincaId) {
  const snap = await db.collection(COL_DEBT_SIMS)
    .where('fincaId', '==', fincaId)
    .orderBy('createdAt', 'desc')
    .limit(LIST_LIMIT)
    .get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

// ─── Autopilot config (cross-domain read) ─────────────────────────────────
// Lectura compartida con el dominio autopilot. Necesaria aquí porque el
// kill switch del dominio financing inspecciona `dominios.financing` antes
// de cada handler costoso. Cuando autopilot se reorganice (F5), expone esto
// como helper en `lib/autopilot/` y borra esta función.

async function getAutopilotConfig(fincaId) {
  const doc = await db.collection(COL_AUTOPILOT_CFG).doc(fincaId).get();
  return doc.exists ? doc.data() : {};
}

module.exports = {
  // Snapshots
  createSnapshot,
  listSnapshots,
  // Credit products
  listCreditProducts,
  listActiveCreditProducts,
  createCreditProduct,
  updateCreditProduct,
  removeCreditProduct,
  // Eligibility
  createEligibilityAnalysis,
  listEligibilityAnalyses,
  // Debt simulations
  createDebtSimulation,
  listDebtSimulations,
  // Cross-domain
  getAutopilotConfig,
};
