// POST /api/rfqs/:id/close — picks a winner from the responses and marks
// the RFQ closed. Does NOT create a purchase order; the UI can do that via
// the normal OC flow using the winner's price + supplier.
//
// Query/body flag `useClaude=1` escalates the decision to Claude (phase
// 2.5). Claude sees the deterministic pick plus each supplier's history
// signals and either ratifies or overrides. Any failure — timeout, non-
// tool-use response, invalid supplierId — falls back silently to the
// deterministic winner.

const { db, Timestamp } = require('../../lib/firebase');
const { verifyOwnership, hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { pickWinner } = require('../../lib/procurement/rfqWinner');
const { reasonAboutRfqWinner } = require('../../lib/procurement/rfqReasoner');

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

    const { winner: deterministicWinner, rankedEligible, rejected } = pickWinner(rfq.responses || [], {
      maxLeadTimeDays: rfq.maxLeadTimeDays ?? null,
      currency: rfq.currency || null,
    });

    const useClaude = req.query.useClaude === '1' || req.body?.useClaude === true;
    let chosenWinner = deterministicWinner;
    let decisionSource = 'deterministic';
    let winnerReasoning = null;
    let rationale = null;
    let overrode = false;

    if (useClaude && rankedEligible.length >= 2) {
      const claudeResult = await reasonAboutRfqWinner({
        rfq,
        deterministicWinner,
        eligibleResponses: rankedEligible,
        fincaId: req.fincaId,
      });
      if (claudeResult) {
        chosenWinner = claudeResult.winner;
        rationale = claudeResult.rationale;
        winnerReasoning = claudeResult.reasoning;
        decisionSource = 'claude';
        overrode = deterministicWinner && deterministicWinner.supplierId !== chosenWinner.supplierId;
      }
    }

    const update = {
      estado: 'closed',
      winner: chosenWinner ? sanitizeWinner(chosenWinner) : null,
      winnerRationale: rationale,
      decisionSource,
      winnerReasoning,
      closedAt: Timestamp.now(),
      closedBy: req.uid || null,
      closeSummary: {
        eligibleCount: rankedEligible.length,
        rejectedCount: rejected.length,
        overrodeDeterministic: overrode,
      },
    };

    await db.collection('rfqs').doc(req.params.id).update(update);

    const canSeeReasoning = hasMinRoleBE(req.userRole, 'supervisor');
    res.json({
      ok: true,
      winner: update.winner,
      decisionSource,
      rationale,
      overrodeDeterministic: overrode,
      winnerReasoning: canSeeReasoning ? winnerReasoning : null,
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
