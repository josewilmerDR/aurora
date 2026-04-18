// Pure delivery-quality metrics for a supplier.
//
// Inputs are plain JS docs already filtered to the supplier of interest. Dates
// must be JS `Date` objects (the caller converts Firestore Timestamps / ISO
// strings). No Firestore access here.

const MS_PER_DAY = 86400000;

// Average days between order date and reception date.
// - Joins receptions to their orders by `ordenCompraId` (primary) or `poNumber`.
// - A single order with multiple partial receptions contributes the lead time
//   of its FIRST reception — that is the "time to first delivery" signal.
// - Returns { avgDays, sampleCount }. avgDays = null when no samples.
function avgLeadTimeDays(orders, receptions) {
  const orderById = new Map();
  const orderByPo = new Map();
  for (const o of orders || []) {
    if (!o) continue;
    if (o.id) orderById.set(o.id, o);
    if (o.poNumber) orderByPo.set(o.poNumber, o);
  }

  const firstReceptionByOrder = new Map();
  for (const r of receptions || []) {
    if (!r || !(r.fechaRecepcion instanceof Date)) continue;
    const order = (r.ordenCompraId && orderById.get(r.ordenCompraId))
      || (r.poNumber && orderByPo.get(r.poNumber))
      || null;
    if (!order || !(order.fecha instanceof Date)) continue;
    const prev = firstReceptionByOrder.get(order.id || order.poNumber);
    if (!prev || r.fechaRecepcion < prev.receptionDate) {
      firstReceptionByOrder.set(order.id || order.poNumber, {
        orderDate: order.fecha,
        receptionDate: r.fechaRecepcion,
      });
    }
  }

  const samples = Array.from(firstReceptionByOrder.values())
    .map(({ orderDate, receptionDate }) => (receptionDate - orderDate) / MS_PER_DAY)
    .filter(d => Number.isFinite(d) && d >= 0);

  if (samples.length === 0) return { avgDays: null, sampleCount: 0 };
  const avg = samples.reduce((s, d) => s + d, 0) / samples.length;
  return { avgDays: round2(avg), sampleCount: samples.length };
}

// Fill rate = sum(cantidadRecibida) / sum(cantidadOC) across all receptions.
// Returns { rate, sampleCount } where sampleCount is the number of reception
// line items that contributed. rate = null when nothing to measure.
function fillRate(receptions) {
  let requested = 0;
  let received = 0;
  let items = 0;
  for (const r of receptions || []) {
    if (!r || !Array.isArray(r.items)) continue;
    for (const it of r.items) {
      const oc = Number(it.cantidadOC);
      const got = Number(it.cantidadRecibida);
      if (!Number.isFinite(oc) || oc <= 0) continue;
      if (!Number.isFinite(got) || got < 0) continue;
      requested += oc;
      received += got;
      items += 1;
    }
  }
  if (items === 0 || requested === 0) return { rate: null, sampleCount: 0 };
  return { rate: round4(received / requested), sampleCount: items };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

module.exports = {
  avgLeadTimeDays,
  fillRate,
};
