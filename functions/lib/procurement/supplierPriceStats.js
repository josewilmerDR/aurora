// Pure price statistics derived from purchase orders.
//
// Two concerns live here:
//   - `pricesByProduct(orders, currency)` — per product, the supplier's own
//     average unit price and sample count. Input should be the subset of OCs
//     already filtered to a single supplier.
//   - `marketMedianByProduct(allOrders, currency)` — per product, the median
//     unit price across ALL suppliers in the finca. Used to compute a
//     supplier's priceIndex (how cheap it is vs. market).
//
// Currency: items carry their own `moneda`. The caller picks one currency
// (default USD) and items in other currencies are ignored — v1 does not
// convert FX. If mixed currencies become common we will add a conversion
// step outside this lib.

function pricesByProduct(orders, currency = 'USD') {
  const accByProduct = new Map(); // productoId -> { sumPriceTimesQty, sumQty, samples, unit, name }
  for (const order of orders || []) {
    if (!order || !Array.isArray(order.items)) continue;
    for (const item of order.items) {
      if (!matchesCurrency(item, currency)) continue;
      const price = Number(item.precioUnitario);
      const qty = Number(item.cantidad);
      if (!(price > 0) || !(qty > 0)) continue;
      const key = item.productoId || normalizeKey(item.nombreComercial);
      if (!key) continue;
      const bucket = accByProduct.get(key) || {
        sumPriceTimesQty: 0,
        sumQty: 0,
        samples: 0,
        unit: item.unidad || '',
        nombreComercial: item.nombreComercial || '',
      };
      bucket.sumPriceTimesQty += price * qty;
      bucket.sumQty += qty;
      bucket.samples += 1;
      accByProduct.set(key, bucket);
    }
  }
  const out = {};
  for (const [key, b] of accByProduct) {
    out[key] = {
      avgPrice: round4(b.sumPriceTimesQty / b.sumQty),
      sampleCount: b.samples,
      unit: b.unit,
      nombreComercial: b.nombreComercial,
    };
  }
  return out;
}

function marketMedianByProduct(allOrders, currency = 'USD') {
  const pricesByKey = new Map(); // productoId -> number[]
  for (const order of allOrders || []) {
    if (!order || !Array.isArray(order.items)) continue;
    for (const item of order.items) {
      if (!matchesCurrency(item, currency)) continue;
      const price = Number(item.precioUnitario);
      if (!(price > 0)) continue;
      const key = item.productoId || normalizeKey(item.nombreComercial);
      if (!key) continue;
      const list = pricesByKey.get(key) || [];
      list.push(price);
      pricesByKey.set(key, list);
    }
  }
  const out = {};
  for (const [key, prices] of pricesByKey) {
    out[key] = { median: round4(median(prices)), sampleCount: prices.length };
  }
  return out;
}

function matchesCurrency(item, currency) {
  const c = (item.moneda || 'USD').toUpperCase();
  return c === String(currency).toUpperCase();
}

function normalizeKey(name) {
  if (typeof name !== 'string') return '';
  return name.trim().toLowerCase();
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round4(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

module.exports = {
  pricesByProduct,
  marketMedianByProduct,
};
