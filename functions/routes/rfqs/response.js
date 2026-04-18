// POST /api/rfqs/:id/respuesta — records a supplier's reply to an RFQ.
//
// v1 assumes responses are logged manually by the operator (inbound WhatsApp
// webhook + Claude parsing is deferred). The supplier must be one of those
// contacted in the original RFQ; we dedupe on supplierId so a corrected
// response replaces the earlier one instead of stacking.

const { db, FieldValue, Timestamp } = require('../../lib/firebase');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

async function recordRfqResponse(req, res) {
  try {
    const ownership = await verifyOwnership('rfqs', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const rfq = ownership.doc.data();

    if (rfq.estado === 'closed' || rfq.estado === 'cancelled') {
      return sendApiError(res, ERROR_CODES.CONFLICT, `RFQ is ${rfq.estado} — cannot append responses.`, 409);
    }

    const body = req.body || {};
    const supplierId = typeof body.supplierId === 'string' ? body.supplierId : '';
    if (!supplierId) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'supplierId is required.', 400);

    const contacted = Array.isArray(rfq.suppliersContacted) ? rfq.suppliersContacted : [];
    const match = contacted.find(c => c.supplierId === supplierId);
    if (!match) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED,
        'Supplier was not part of this RFQ.', 400);
    }

    const precioUnitario = Number(body.precioUnitario);
    if (body.disponible !== false && !(precioUnitario > 0)) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED,
        'precioUnitario must be > 0 when available.', 400);
    }
    const leadTimeDays = body.leadTimeDays == null ? null : Number(body.leadTimeDays);
    if (leadTimeDays != null && (!Number.isFinite(leadTimeDays) || leadTimeDays < 0)) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'leadTimeDays must be a non-negative number.', 400);
    }

    const entry = {
      supplierId,
      supplierName: match.supplierName || '',
      precioUnitario: Number.isFinite(precioUnitario) ? precioUnitario : 0,
      disponible: body.disponible !== false,
      leadTimeDays: leadTimeDays == null ? null : leadTimeDays,
      moneda: typeof body.moneda === 'string' && body.moneda ? body.moneda : rfq.currency || 'USD',
      notas: typeof body.notas === 'string' ? body.notas.slice(0, 500) : '',
      respondedAt: Timestamp.now(),
      loggedBy: req.uid || null,
    };

    // Dedup on supplierId: remove any prior entry, then append the new one.
    const existing = Array.isArray(rfq.responses) ? rfq.responses : [];
    const filtered = existing.filter(r => r.supplierId !== supplierId);
    filtered.push(entry);

    await db.collection('rfqs').doc(req.params.id).update({
      responses: filtered,
      lastResponseAt: FieldValue.serverTimestamp(),
    });

    res.status(201).json({ ok: true, entry, totalResponses: filtered.length });
  } catch (error) {
    console.error('[RFQS] response failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to record response.', 500);
  }
}

module.exports = { recordRfqResponse };
