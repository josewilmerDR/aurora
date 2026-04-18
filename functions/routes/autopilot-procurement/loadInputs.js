// Firestore-facing loader for the procurement agent. Bundles the reads so
// the handler body stays focused on orchestration.

const { db } = require('../../lib/firebase');
const { fetchStockInputs } = require('../procurement/fetchStockInputs');
const { fetchOrdersAndReceptions } = require('../suppliers/fetchHistory');

async function loadAgentInputs(fincaId, lookbackWeeks, now) {
  const [configSnap, stockInputs, history, suppliersSnap] = await Promise.all([
    db.collection('autopilot_config').doc(fincaId).get(),
    fetchStockInputs(fincaId, lookbackWeeks, now),
    fetchOrdersAndReceptions(fincaId),
    db.collection('proveedores').where('fincaId', '==', fincaId).get(),
  ]);
  const config = configSnap.exists ? configSnap.data() : {};
  const suppliers = suppliersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  return { config, stockInputs, history, suppliers };
}

module.exports = { loadAgentInputs };
