// Loads purchase orders and receptions for a finca and converts Firestore
// Timestamps to JS Date objects so the pure libs can consume them directly.
//
// v1 loads the full history per request (no pagination, no caching). At our
// expected scale — a few thousand OCs per finca — this is fine. If it
// becomes hot we materialize into `supplier_metrics/{supplierId}` via cron.

const { db } = require('../../lib/firebase');

function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function fetchOrdersAndReceptions(fincaId) {
  const [ordersSnap, receptionsSnap] = await Promise.all([
    db.collection('ordenes_compra').where('fincaId', '==', fincaId).get(),
    db.collection('recepciones').where('fincaId', '==', fincaId).get(),
  ]);
  const orders = ordersSnap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      fecha: tsToDate(data.fecha),
      fechaEntrega: tsToDate(data.fechaEntrega),
      createdAt: tsToDate(data.createdAt),
    };
  });
  const receptions = receptionsSnap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      fechaRecepcion: tsToDate(data.fechaRecepcion),
      createdAt: tsToDate(data.createdAt),
    };
  });
  return { orders, receptions };
}

module.exports = {
  fetchOrdersAndReceptions,
  tsToDate,
};
