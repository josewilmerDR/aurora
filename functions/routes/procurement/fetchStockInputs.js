// Firestore-facing loader for the stock analyzer.
//
// Fetches products plus the subset of `movimientos` inside the lookback
// window. We filter `fincaId + fecha` at Firestore (index-backed) and let
// the pure analyzer filter `tipo` in memory — avoids needing a separate
// composite index for one consumer.

const { db, Timestamp } = require('../../lib/firebase');

const MS_PER_WEEK = 7 * 86400000;

async function fetchStockInputs(fincaId, lookbackWeeks, now) {
  const cutoff = new Date(now.getTime() - lookbackWeeks * MS_PER_WEEK);
  const [productsSnap, movsSnap] = await Promise.all([
    db.collection('productos').where('fincaId', '==', fincaId).get(),
    db.collection('movimientos')
      .where('fincaId', '==', fincaId)
      .where('fecha', '>=', Timestamp.fromDate(cutoff))
      .orderBy('fecha', 'desc')
      .get(),
  ]);
  const products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const movimientos = movsSnap.docs.map(d => {
    const data = d.data();
    return { id: d.id, ...data, fecha: data.fecha ? data.fecha.toDate() : null };
  });
  return { products, movimientos };
}

module.exports = { fetchStockInputs };
