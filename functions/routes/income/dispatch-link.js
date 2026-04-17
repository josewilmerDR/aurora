// Convierte un `cosecha_despachos` en un borrador de `income_records`.
// No persiste — el frontend lo completa con buyer/price y hace POST.

const { db } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

async function draftFromDispatch(req, res) {
  try {
    const { despachoId } = req.params;
    const doc = await db.collection('cosecha_despachos').doc(despachoId).get();
    if (!doc.exists) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Dispatch not found.', 404);
    }
    const d = doc.data();
    if (d.fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Dispatch belongs to another finca.', 403);
    }
    if (d.estado === 'anulado') {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Dispatch is cancelled.', 409);
    }

    res.json({
      draft: {
        date: d.fecha,
        loteId: d.loteId || null,
        loteNombre: d.loteNombre || null,
        grupo: d.grupo || null,
        despachoId,
        quantity: d.cantidad,
        unit: d.unidad || '',
        currency: 'USD',
        collectionStatus: 'pendiente',
        note: d.nota || '',
      },
    });
  } catch (error) {
    console.error('[INCOME] draft from dispatch failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to build draft from dispatch.', 500);
  }
}

module.exports = { draftFromDispatch };
