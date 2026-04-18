// Pure supplier ranking — shared by the /api/suppliers/ranking route and the
// procurement agent. Given the supplier roster, history docs and market
// medians, returns suppliers scored and sorted from best to worst.
//
// Extracted from routes/suppliers/ranking.js so the agent can rank suppliers
// without re-implementing the loop or importing from a route module.

const { collectSupplierSignals } = require('./supplierSignals');
const { scoreSupplier } = require('./supplierScore');

// Inputs:
//   suppliers      — array of { id, nombre, aliases?, estado?, categoria?, ... }
//   orders         — all orden_compra docs for the finca (dates as Date)
//   receptions     — all recepciones docs for the finca (dates as Date)
//   marketMedians  — output of marketMedianByProduct(orders, currency)
//   opts.productoId — when set, filters to suppliers that have sold it AND
//                     focuses the price subscore on that product
//   opts.currency   — passed through to signal collection (default USD)
//
// Returns an array sorted high → low. Suppliers with `score: null` trail
// scored ones.
function rankSuppliers({ suppliers, orders, receptions, marketMedians, opts = {} }) {
  const currency = opts.currency || 'USD';
  const productoId = opts.productoId || undefined;

  const rows = [];
  for (const supplier of suppliers || []) {
    if (!supplier?.nombre) continue;
    if (supplier.estado === 'inactivo') continue;

    const signals = collectSupplierSignals({
      supplierName: supplier.nombre,
      aliases: Array.isArray(supplier.aliases) ? supplier.aliases : [],
      orders,
      receptions,
      currency,
    });
    if (productoId && !signals.productosOfrecidos.includes(productoId)) continue;

    const scored = scoreSupplier(signals, marketMedians, productoId ? { productoId } : {});
    rows.push({
      supplierId: supplier.id,
      supplierName: supplier.nombre,
      categoria: supplier.categoria || '',
      score: scored.score,
      breakdown: scored.breakdown,
      signals,
      priceForProduct: productoId ? (signals.pricesByProduct[productoId] || null) : null,
    });
  }

  rows.sort(byScoreDesc);
  return rows;
}

function byScoreDesc(a, b) {
  if (a.score == null && b.score == null) return 0;
  if (a.score == null) return 1;
  if (b.score == null) return -1;
  return b.score - a.score;
}

module.exports = {
  rankSuppliers,
};
