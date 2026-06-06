// Procurement-invoices — listado de movimientos de inventario.
//
// Sub-archivo del split de routes/procurement-invoices.js. Único endpoint:
// GET /api/movimientos. El ledger de `movimientos` es el registro
// inmutable de todo cambio de stock (ingresos por compras/recepciones,
// egresos por aplicación de cédulas, ajustes manuales). Otros endpoints
// (compras, cedulas, recepciones) son los que escriben aquí; éste sólo lee.
//
// Filtros opcionales:
//   - productoId  — historial de un solo producto
//   - fechaDesde  — YYYY-MM-DD inclusive
//   - fechaHasta  — YYYY-MM-DD inclusive (hasta 23:59:59 del día)
// Cap: 500 documentos.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { rateLimit } = require('../../lib/rateLimit');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Rate-limited: cada request es un query con limit(500) garantizado, y el
// ledger expone precios, proveedores y números de factura. encargado+ porque
// el módulo Bodega y la UI del historial ya gatean a ese piso; el gate vivía
// sólo en el frontend (bypasseable con token).
router.get('/api/movimientos', authenticate, rateLimit('movimientos_read', 'public_read'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read movimientos.', 403);
    }
    const { productoId, fechaDesde, fechaHasta } = req.query;
    if (productoId !== undefined && (typeof productoId !== 'string' || productoId.length > 128)) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid productoId.', 400);
    }
    if (fechaDesde !== undefined && !DATE_RE.test(fechaDesde)) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid fechaDesde (expected YYYY-MM-DD).', 400);
    }
    if (fechaHasta !== undefined && !DATE_RE.test(fechaHasta)) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid fechaHasta (expected YYYY-MM-DD).', 400);
    }
    let query = db.collection('movimientos')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc')
      .limit(500);
    if (productoId) {
      query = db.collection('movimientos')
        .where('fincaId', '==', req.fincaId)
        .where('productoId', '==', productoId)
        .orderBy('fecha', 'desc')
        .limit(500);
    }
    if (fechaDesde) {
      query = query.where('fecha', '>=', Timestamp.fromDate(new Date(fechaDesde + 'T00:00:00')));
    }
    if (fechaHasta) {
      query = query.where('fecha', '<=', Timestamp.fromDate(new Date(fechaHasta + 'T23:59:59')));
    }
    const snapshot = await query.get();
    const movimientos = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      fecha: doc.data().fecha.toDate().toISOString(),
    }));
    res.status(200).json(movimientos);
  } catch (error) {
    console.error('[movimientos:list]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch movimientos.', 500);
  }
});

module.exports = router;
