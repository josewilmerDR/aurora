// GET /api/suppliers/ranking?productoId=...&currency=USD
//
// Returns every active supplier scored and sorted high → low. When productoId
// is set, the list is filtered to suppliers that have actually sold that
// product, and the price subscore narrows to that product's price index.

const { db } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { collectSupplierSignals } = require('../../lib/procurement/supplierSignals');
const { marketMedianByProduct } = require('../../lib/procurement/supplierPriceStats');
const { scoreSupplier } = require('../../lib/procurement/supplierScore');
const { fetchOrdersAndReceptions } = require('./fetchHistory');

async function getSupplierRanking(req, res) {
  try {
    const currency = typeof req.query.currency === 'string' ? req.query.currency : 'USD';
    const productoId = typeof req.query.productoId === 'string' && req.query.productoId
      ? req.query.productoId
      : undefined;

    const [suppliersSnap, history] = await Promise.all([
      db.collection('proveedores').where('fincaId', '==', req.fincaId).get(),
      fetchOrdersAndReceptions(req.fincaId),
    ]);
    const suppliers = suppliersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.nombre && s.estado !== 'inactivo');

    const market = marketMedianByProduct(history.orders, currency);

    const rows = [];
    for (const supplier of suppliers) {
      const signals = collectSupplierSignals({
        supplierName: supplier.nombre,
        aliases: Array.isArray(supplier.aliases) ? supplier.aliases : [],
        orders: history.orders,
        receptions: history.receptions,
        currency,
      });
      if (productoId && !signals.productosOfrecidos.includes(productoId)) continue;

      const scored = scoreSupplier(signals, market, productoId ? { productoId } : {});
      rows.push({
        supplierId: supplier.id,
        supplierName: supplier.nombre,
        categoria: supplier.categoria || '',
        score: scored.score,
        breakdown: scored.breakdown,
        orderCount: signals.orderCount,
        avgLeadTimeDays: signals.avgLeadTimeDays,
        fillRate: signals.fillRate,
        priceForProduct: productoId ? (signals.pricesByProduct[productoId] || null) : null,
        lastOrderDate: signals.lastOrderDate ? signals.lastOrderDate.toISOString() : null,
      });
    }

    rows.sort(byScoreDesc);

    res.json({
      productoId: productoId || null,
      currency,
      count: rows.length,
      rows,
    });
  } catch (error) {
    console.error('[SUPPLIERS] ranking failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute supplier ranking.', 500);
  }
}

// Nulls rank below any scored supplier. Among nulls, order is stable.
function byScoreDesc(a, b) {
  if (a.score == null && b.score == null) return 0;
  if (a.score == null) return 1;
  if (b.score == null) return -1;
  return b.score - a.score;
}

module.exports = { getSupplierRanking };
