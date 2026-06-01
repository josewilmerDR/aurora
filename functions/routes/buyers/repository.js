// Repositorio del dominio `buyers`. Único archivo del dominio que toca
// db.collection().
//
// Nota: a diferencia de budgets, el dominio buyers no estampa el autor
// (`createdBy`/`updatedBy`) en las escrituras. Sí estampa `createdAt` y
// `updatedAt` para tener trazabilidad temporal mínima; el estampado de autor
// queda pendiente hasta que el equipo lo estandarice (issue: auditoría uniforme).

const { db, FieldValue } = require('../../lib/firebase');

const COLLECTION = 'buyers';

async function listByFinca(fincaId) {
  const snap = await db.collection(COLLECTION)
    .where('fincaId', '==', fincaId)
    .orderBy('name', 'asc')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function findIdByTaxId(fincaId, taxId) {
  const snap = await db.collection(COLLECTION)
    .where('fincaId', '==', fincaId)
    .where('taxId', '==', taxId)
    .limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

async function create(fincaId, data) {
  const doc = await db.collection(COLLECTION).add({
    ...data,
    fincaId,
    createdAt: FieldValue.serverTimestamp(),
  });
  return doc.id;
}

async function update(id, data) {
  await db.collection(COLLECTION).doc(id).update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function remove(id) {
  await db.collection(COLLECTION).doc(id).delete();
}

module.exports = {
  listByFinca,
  findIdByTaxId,
  create,
  update,
  remove,
};
