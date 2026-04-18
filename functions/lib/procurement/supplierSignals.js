// Composer for supplier signals.
//
// Given raw purchase-order and reception docs across the whole finca plus the
// canonical name (and optional aliases) of one supplier, returns a compact
// summary usable by the scoring lib. Pure — no Firestore, no network.
//
// Caller contract: dates on input docs must be JS `Date` objects. The route
// converts Firestore Timestamps / ISO strings before calling.

const { matchesSupplier } = require('./supplierNameMatch');
const { avgLeadTimeDays, fillRate } = require('./supplierDelivery');
const { pricesByProduct } = require('./supplierPriceStats');

function collectSupplierSignals({
  supplierName,
  aliases = [],
  orders = [],
  receptions = [],
  currency = 'USD',
}) {
  const supplierOrders = orders.filter(o => matchesSupplier(o?.proveedor, supplierName, aliases));
  const orderIds = new Set(supplierOrders.map(o => o.id).filter(Boolean));
  const orderPoNumbers = new Set(supplierOrders.map(o => o.poNumber).filter(Boolean));

  // A reception belongs to this supplier if its ordenCompraId matches one of
  // our orders OR its proveedor string matches by name. Name is the fallback
  // because legacy receptions may lack ordenCompraId.
  const supplierReceptions = receptions.filter(r => {
    if (!r) return false;
    if (r.ordenCompraId && orderIds.has(r.ordenCompraId)) return true;
    if (r.poNumber && orderPoNumbers.has(r.poNumber)) return true;
    return matchesSupplier(r.proveedor, supplierName, aliases);
  });

  const lead = avgLeadTimeDays(supplierOrders, supplierReceptions);
  const fill = fillRate(supplierReceptions);
  const prices = pricesByProduct(supplierOrders, currency);

  const productosOfrecidos = Object.keys(prices);
  const lastOrderDate = supplierOrders.reduce((acc, o) => {
    if (!(o?.fecha instanceof Date)) return acc;
    if (!acc || o.fecha > acc) return o.fecha;
    return acc;
  }, null);

  return {
    supplierName,
    currency,
    orderCount: supplierOrders.length,
    receptionCount: supplierReceptions.length,
    avgLeadTimeDays: lead.avgDays,
    leadTimeSamples: lead.sampleCount,
    fillRate: fill.rate,
    fillRateSamples: fill.sampleCount,
    pricesByProduct: prices,
    productosOfrecidos,
    lastOrderDate,
  };
}

module.exports = {
  collectSupplierSignals,
};
