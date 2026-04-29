// Repositorio del dominio `buyers`. Único archivo del dominio que toca
// db.collection().
//
// Nota: a diferencia de budgets, el dominio buyers no estampa `createdBy` ni
// campos de auditoría en updates. Preservamos esa convención hasta que el
// equipo decida estandarizarlo (issue: estampado de auditoría uniforme).

const { db, FieldValue } = require('../../lib/firebase');

const COLLECTION = 'buyers';

async function listByFinca(fincaId) {
  const snap = await db.collection(COLLECTION)
    .where('fincaId', '==', fincaId)
    .orderBy('name', 'asc')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
  await db.collection(COLLECTION).doc(id).update(data);
}

async function remove(id) {
  await db.collection(COLLECTION).doc(id).delete();
}

module.exports = {
  listByFinca,
  create,
  update,
  remove,
};
