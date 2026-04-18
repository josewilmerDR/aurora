// GET /api/procurement/stock-gaps
//
// Returns a prioritized list of products that need reordering. Each row
// exposes the signals the procurement agent (phase 2.2) will use to size
// the OC: stock, consumption, days of coverage, suggested quantity and
// urgency band.
//
// Query params (all optional):
//   lookbackWeeks     — consumption window (default 8)
//   leadTimeDays      — expected delivery time (default 14)
//   safetyFactor      — demand multiplier (default 1.2)

const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { weeklyConsumptionByProduct } = require('../../lib/procurement/consumptionStats');
const { analyzeStock } = require('../../lib/procurement/stockAnalyzer');
const { fetchStockInputs } = require('./fetchStockInputs');

function parsePositiveNumber(value, fallback, { min = 0.01, max = 1000 } = {}) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

async function getStockGaps(req, res) {
  try {
    const now = new Date();
    const lookbackWeeks = parsePositiveNumber(req.query.lookbackWeeks, 8, { min: 1, max: 52 });
    const leadTimeDays = parsePositiveNumber(req.query.leadTimeDays, 14, { min: 1, max: 365 });
    const safetyFactor = parsePositiveNumber(req.query.safetyFactor, 1.2, { min: 1, max: 5 });

    const { products, movimientos } = await fetchStockInputs(req.fincaId, lookbackWeeks, now);
    const consumption = weeklyConsumptionByProduct(movimientos, { now, lookbackWeeks });
    const gaps = analyzeStock({
      products,
      consumption,
      opts: { leadTimeDays, safetyFactor },
    });

    const counts = gaps.reduce((acc, g) => {
      acc[g.urgency] = (acc[g.urgency] || 0) + 1;
      return acc;
    }, {});

    res.json({
      generatedAt: now.toISOString(),
      window: { lookbackWeeks, leadTimeDays, safetyFactor },
      totalProducts: products.length,
      totalMovements: movimientos.length,
      gapsCount: gaps.length,
      counts,
      gaps,
    });
  } catch (error) {
    console.error('[PROCUREMENT] stock-gaps failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute stock gaps.', 500);
  }
}

module.exports = { getStockGaps };
