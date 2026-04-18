// POST /api/rfqs/:id/close — picks a winner from the responses and marks
// the RFQ closed. Does NOT create a purchase order; the UI can do that via
// the normal OC flow using the winner's price + supplier. Wiring the
// procurement agent to auto-OC an RFQ winner is a follow-up.

const { db, Timestamp } = require('../../lib/firebase');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { pickWinner } = require('../../lib/procurement/rfqWinner');

async function closeRfq(req, res) {
  try {
    const ownership = await verifyOwnership('rfqs', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const rfq = ownership.doc.data();

    if (rfq.estado === 'closed') {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'RFQ is already closed.', 409);
    }
    if (rfq.estado === 'cancelled') {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'RFQ is cancelled.', 409);
    }

    const { winner, rankedEligible, rejected } = pickWinner(rfq.responses || [], {
      maxLeadTimeDays: rfq.maxLeadTimeDays ?? null,
      currency: rfq.currency || null,
    });

    const update = {
      estado: 'closed',
      winner: winner ? sanitizeWinner(winner) : null,
      closedAt: Timestamp.now(),
      closedBy: req.uid || null,
      closeSummary: {
        eligibleCount: rankedEligible.length,
        rejectedCount: rejected.length,
      },
    };

    await db.collection('rfqs').doc(req.params.id).update(update);

    res.json({
      ok: true,
      winner: update.winner,
      rankedEligible: rankedEligible.map(sanitizeWinner),
      rejected: rejected.map(r => ({
        supplierId: r.supplierId,
        supplierName: r.supplierName,
        reason: r.reason,
      })),
    });
  } catch (error) {
    console.error('[RFQS] close failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to close RFQ.', 500);
  }
}

function sanitizeWinner(w) {
  if (!w) return null;
  return {
    supplierId: w.supplierId,
    supplierName: w.supplierName,
    precioUnitario: w.precioUnitario,
    leadTimeDays: w.leadTimeDays,
    moneda: w.moneda || null,
  };
}

module.exports = { closeRfq };
