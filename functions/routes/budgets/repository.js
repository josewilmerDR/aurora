// Repositorio del dominio `budgets`. Único archivo del dominio que toca
// db.collection(). Los handlers en crud.js + execution.js importan funciones
// de este módulo y nunca llaman a Firestore directamente.
//
// Convención: los nombres de función describen la operación de negocio
// (`listByFinca`, `listForPeriod`, `create`...) y no la mecánica Firestore
// (no `getDocs`, `addDoc`...). El stamping de campos de auditoría
// (`createdAt`, `createdBy`, `updatedBy`, `updatedAt`) vive aquí porque es
// una preocupación de persistencia, no de negocio.

const { db, FieldValue } = require('../../lib/firebase');

const COLLECTION = 'budgets';

// ─── Lecturas ─────────────────────────────────────────────────────────────

// Lista los presupuestos de la finca. Filtros opcionales por período y
// categoría se aplican como `where`s adicionales para que Firestore haga
// el trabajo en el lado del servidor.
async function listByFinca(fincaId, { period, category } = {}) {
  let q = db.collection(COLLECTION).where('fincaId', '==', fincaId);
  if (typeof period === 'string' && period) q = q.where('period', '==', period);
  if (typeof category === 'string' && category) q = q.where('category', '==', category);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Variante usada por el endpoint de ejecución: siempre filtra por período.
// Separada de listByFinca() porque el caller es distinto y la firma queda
// más explícita en el sitio de uso.
async function listForPeriod(fincaId, period) {
  const snap = await db.collection(COLLECTION)
    .where('fincaId', '==', fincaId)
    .where('period', '==', period)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─── Mutaciones ───────────────────────────────────────────────────────────

async function create(fincaId, { uid, userEmail }, data) {
  const doc = await db.collection(COLLECTION).add({
    ...data,
    fincaId,
    createdBy: uid,
    createdByEmail: userEmail || '',
    createdAt: FieldValue.serverTimestamp(),
  });
  return doc.id;
}

async function update(id, { uid }, data) {
  await db.collection(COLLECTION).doc(id).update({
    ...data,
    updatedBy: uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function remove(id) {
  await db.collection(COLLECTION).doc(id).delete();
}

module.exports = {
  listByFinca,
  listForPeriod,
  create,
  update,
  remove,
};
