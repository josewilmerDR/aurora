// Guards de integridad del dominio Cosecha que SÍ tocan Firestore (por eso viven
// acá y no en validation.js, que es lógica pura de payload). Centralizan el
// invariante "una boleta pertenece a lo sumo a un despacho ACTIVO": lo consumen
// el borrado y la edición de registros, y la creación y reactivación de
// despachos, para no duplicar el escaneo ni que la regla diverja entre callers.

const { db } = require('../../lib/firebase');

// Devuelve el primer despacho ACTIVO de la finca que referencia alguna de las
// boletas en `ids`, o null si ninguna está en uso. `excludeDispatchId` evita que
// un despacho se detecte a sí mismo (caso reactivación). Query por fincaId
// (índice de campo único) + filtro de estado/boletas en memoria — mismo patrón
// que el resto del dominio, sin requerir índice compuesto.
async function findActiveDispatchUsingBoletas(fincaId, ids, { excludeDispatchId = null } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const idSet = new Set(ids.filter(Boolean));
  if (idSet.size === 0) return null;
  const snap = await db.collection('cosecha_despachos')
    .where('fincaId', '==', fincaId)
    .get();
  const match = snap.docs.find(d =>
    d.id !== excludeDispatchId
    && d.data().estado !== 'anulado'
    && Array.isArray(d.data().boletas)
    && d.data().boletas.some(b => b && idSet.has(b.id)));
  return match || null;
}

// Devuelve el primer income_record ACTIVO de la finca que referencia el despacho
// `despachoId`, o null. "Activo" = collectionStatus !== 'anulado' (un ingreso
// anulado ya no cuenta plata, así que no debe bloquear). La referencia puede
// venir por el array nuevo `despachoIds[].id` o por el campo legacy `despachoId`
// (string). income_records pertenece al dominio de ingresos, pero lo leemos acá
// porque es Cosecha quien impone el invariante "no podés anular un despacho que
// aún sostiene un ingreso". Query por fincaId + filtro en memoria (array-contains
// no aplica sobre un sub-campo de objeto), mismo patrón del resto del dominio.
async function findIncomeReferencingDispatch(fincaId, despachoId) {
  if (!despachoId) return null;
  const snap = await db.collection('income_records')
    .where('fincaId', '==', fincaId)
    .get();
  const match = snap.docs.find(d => {
    const data = d.data();
    if (data.collectionStatus === 'anulado') return false;
    if (data.despachoId === despachoId) return true;
    return Array.isArray(data.despachoIds) && data.despachoIds.some(x => x && x.id === despachoId);
  });
  return match || null;
}

module.exports = { findActiveDispatchUsingBoletas, findIncomeReferencingDispatch };
