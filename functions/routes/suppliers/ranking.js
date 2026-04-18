// GET /api/suppliers/ranking?productoId=...&currency=USD
//
// Returns every active supplier scored and sorted high → low. When productoId
// is set, the list is filtered to suppliers that have actually sold that
// product, and the price subscore narrows to that product's price index.
//
// The ranking logic itself lives in lib/procurement/supplierRanking.js so
// the procurement agent (phase 2.2) can reuse it without importing from
// a route module.

const { db } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rankSuppliers } = require('../../lib/procurement/supplierRanking');
const { marketMedianByProduct } = require('../../lib/procurement/supplierPriceStats');
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
    const suppliers = suppliersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const marketMedians = marketMedianByProduct(history.orders, currency);

    const ranked = rankSuppliers({
      suppliers,
      orders: history.orders,
      receptions: history.receptions,
      marketMedians,
      opts: { productoId, currency },
    });

    const rows = ranked.map(r => ({
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      categoria: r.categoria,
      score: r.score,
      breakdown: r.breakdown,
      orderCount: r.signals.orderCount,
      avgLeadTimeDays: r.signals.avgLeadTimeDays,
      fillRate: r.signals.fillRate,
      priceForProduct: r.priceForProduct,
      lastOrderDate: r.signals.lastOrderDate ? r.signals.lastOrderDate.toISOString() : null,
    }));

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

module.exports = { getSupplierRanking };
