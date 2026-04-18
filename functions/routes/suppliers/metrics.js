// GET /api/suppliers/:id/metrics
//
// Returns full signals and the computed score for one supplier. When a
// `productoId` query param is provided, the price subscore narrows to that
// product (useful when asking "is this supplier good for THIS item?").

const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { collectSupplierSignals } = require('../../lib/procurement/supplierSignals');
const { marketMedianByProduct } = require('../../lib/procurement/supplierPriceStats');
const { scoreSupplier } = require('../../lib/procurement/supplierScore');
const { fetchOrdersAndReceptions } = require('./fetchHistory');

async function getSupplierMetrics(req, res) {
  try {
    const ownership = await verifyOwnership('proveedores', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const supplier = ownership.doc.data();
    const currency = typeof req.query.currency === 'string' ? req.query.currency : 'USD';
    const productoId = typeof req.query.productoId === 'string' && req.query.productoId
      ? req.query.productoId
      : undefined;

    const { orders, receptions } = await fetchOrdersAndReceptions(req.fincaId);
    const signals = collectSupplierSignals({
      supplierName: supplier.nombre,
      aliases: Array.isArray(supplier.aliases) ? supplier.aliases : [],
      orders,
      receptions,
      currency,
    });
    const market = marketMedianByProduct(orders, currency);
    const scored = scoreSupplier(signals, market, productoId ? { productoId } : {});

    res.json({
      supplierId: req.params.id,
      supplierName: supplier.nombre,
      productoId: productoId || null,
      currency,
      score: scored.score,
      breakdown: scored.breakdown,
      signals: {
        orderCount: signals.orderCount,
        receptionCount: signals.receptionCount,
        avgLeadTimeDays: signals.avgLeadTimeDays,
        fillRate: signals.fillRate,
        productosOfrecidos: signals.productosOfrecidos,
        pricesByProduct: signals.pricesByProduct,
        lastOrderDate: signals.lastOrderDate ? signals.lastOrderDate.toISOString() : null,
      },
    });
  } catch (error) {
    console.error('[SUPPLIERS] metrics failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute supplier metrics.', 500);
  }
}

module.exports = { getSupplierMetrics };
