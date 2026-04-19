// POST /api/financing/credit-products/:id/simulate-cost
//
// Given a product + concrete amount/term (and optionally apr, defaulting to
// the product's aprMax as a conservative upper bound), returns the full
// amortization schedule. Read-only; available to supervisor+.

const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE, verifyOwnership } = require('../../lib/helpers');
const { simulateCost } = require('../../lib/financing/creditCostCalculator');

async function simulateCreditCost(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }

    const ownership = await verifyOwnership('credit_products', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const product = ownership.doc.data();

    const body = req.body || {};
    const amount = Number(body.amount);
    const plazoMeses = Number(body.plazoMeses);
    const apr = body.apr === undefined || body.apr === null || body.apr === ''
      ? Number(product.aprMax) // conservative default so the cost isn't understated
      : Number(body.apr);

    // Range checks against the product's declared envelope.
    if (!Number.isFinite(amount) || amount <= 0) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'amount must be > 0.', 400);
    }
    if (amount < product.monedaMin || amount > product.monedaMax) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT,
        `amount must be within [${product.monedaMin}, ${product.monedaMax}] for this product.`, 400);
    }

    if (!Number.isInteger(plazoMeses) || plazoMeses < 1) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'plazoMeses must be a positive integer.', 400);
    }
    if (plazoMeses < product.plazoMesesMin || plazoMeses > product.plazoMesesMax) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT,
        `plazoMeses must be within [${product.plazoMesesMin}, ${product.plazoMesesMax}] for this product.`, 400);
    }

    if (!Number.isFinite(apr) || apr < 0) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'apr must be a non-negative decimal.', 400);
    }
    if (apr < product.aprMin || apr > product.aprMax) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT,
        `apr must be within [${product.aprMin}, ${product.aprMax}] for this product.`, 400);
    }

    const result = simulateCost({
      amount,
      plazoMeses,
      apr,
      esquema: product.esquemaAmortizacion,
    });
    if (result.error) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, result.error, 400);
    }

    res.json({
      productId: req.params.id,
      providerName: product.providerName,
      esquema: product.esquemaAmortizacion,
      moneda: product.moneda,
      ...result,
    });
  } catch (error) {
    console.error('[FINANCING] simulate-cost failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to simulate credit cost.', 500);
  }
}

module.exports = { simulateCreditCost };
