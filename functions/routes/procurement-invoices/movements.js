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
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

const router = Router();

router.get('/api/movimientos', authenticate, async (req, res) => {
  try {
    const { productoId, fechaDesde, fechaHasta } = req.query;
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
