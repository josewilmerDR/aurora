// Endpoint de ejecución presupuestaria: cruza los budgets del período contra
// los costos reales computados por `lib/finance/periodCosts.js`.

const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { periodToDateRange } = require('../../lib/finance/periodRange');
const { computePeriodCosts } = require('../../lib/finance/periodCosts');
const { buildExecutionReport, summarizeExecution } = require('../../lib/finance/budgetConsumption');
const repo = require('./repository');

async function getExecution(req, res) {
  try {
    const { period } = req.query;
    const range = periodToDateRange(period);
    if (!range) {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        'Query param "period" is required (YYYY, YYYY-Qn, or YYYY-MM).',
        400
      );
    }

    const [budgets, costs] = await Promise.all([
      repo.listForPeriod(req.fincaId, period),
      computePeriodCosts(req.fincaId, range),
    ]);

    const rows = buildExecutionReport(budgets, costs);
    const summary = summarizeExecution(rows);

    res.json({
      period,
      range,
      rows,
      summary,
    });
  } catch (error) {
    console.error('[BUDGETS] execution failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute budget execution.', 500);
  }
}

module.exports = { getExecution };
