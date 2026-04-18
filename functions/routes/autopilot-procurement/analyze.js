// POST /api/autopilot/procurement/analyze
//
// Runs the procurement agent:
//   1. Detects stock gaps (phase 2.1)
//   2. Scores suppliers per product (phase 2.0)
//   3. Builds OC or solicitud candidates
//   4. Routes each through N1/N2/N3 like the finance analyzer
//
// Kill switch: `dominios.procurement.activo=false` short-circuits.

const { db, Timestamp } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

const { weeklyConsumptionByProduct } = require('../../lib/procurement/consumptionStats');
const { analyzeStock } = require('../../lib/procurement/stockAnalyzer');
const { marketMedianByProduct } = require('../../lib/procurement/supplierPriceStats');
const { buildProcurementCandidates } = require('../../lib/procurement/procurementCandidates');
const {
  isProcurementDomainActive,
  resolveProcurementLevel,
} = require('../../lib/procurement/procurementDomainGuards');

const { loadAgentInputs } = require('./loadInputs');
const { routeCandidate } = require('./routeCandidate');

function parseNum(value, fallback, { min, max }) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

async function analyze(req, res) {
  try {
    const fincaId = req.fincaId;
    const body = req.body || {};
    const now = new Date();

    const lookbackWeeks = parseNum(body.lookbackWeeks, 8, { min: 1, max: 52 });
    const leadTimeDays = parseNum(body.leadTimeDays, 14, { min: 1, max: 365 });
    const safetyFactor = parseNum(body.safetyFactor, 1.2, { min: 1, max: 5 });
    const currency = typeof body.currency === 'string' ? body.currency : 'USD';

    const { config, stockInputs, history, suppliers } = await loadAgentInputs(fincaId, lookbackWeeks, now);
    const guardrails = config.guardrails || {};

    if (!isProcurementDomainActive(guardrails)) {
      return res.json({
        ran: false,
        reason: 'Dominio procurement desactivado (kill switch).',
        gapsFound: 0,
        candidates: [],
        results: [],
      });
    }

    const consumption = weeklyConsumptionByProduct(stockInputs.movimientos, { now, lookbackWeeks });
    const gaps = analyzeStock({
      products: stockInputs.products,
      consumption,
      opts: { leadTimeDays, safetyFactor },
    });

    const minSupplierScore = Number.isFinite(Number(guardrails.minSupplierScore))
      ? Number(guardrails.minSupplierScore)
      : 60;
    const marketMedians = marketMedianByProduct(history.orders, currency);
    const candidates = buildProcurementCandidates({
      gaps,
      suppliers,
      orders: history.orders,
      receptions: history.receptions,
      marketMedians,
      now,
      opts: { minSupplierScore, leadTimeDays, currency },
    });

    const level = resolveProcurementLevel(guardrails, config.mode);
    const sessionRef = db.collection('autopilot_sessions').doc();
    const sessionId = sessionRef.id;

    const results = [];
    let sessionExecutedCount = 0;
    for (const candidate of candidates) {
      const row = await routeCandidate({
        candidate,
        level,
        fincaId,
        sessionId,
        guardrails,
        sessionExecutedCount,
        proposedBy: req.uid || null,
        proposedByName: req.userEmail || 'autopilot',
      });
      if (row.status === 'executed') sessionExecutedCount += 1;
      results.push(row);
    }

    if (results.length > 0) {
      await sessionRef.set({
        fincaId,
        kind: 'procurement_analysis',
        level,
        window: { lookbackWeeks, leadTimeDays, safetyFactor, currency },
        startedAt: Timestamp.now(),
        finishedAt: Timestamp.now(),
        actionCount: results.length,
        executedCount: results.filter(r => r.status === 'executed').length,
        proposedCount: results.filter(r => r.status === 'proposed').length,
        failedCount: results.filter(r => r.status === 'failed').length,
      });
    }

    res.json({
      ran: true,
      level,
      gapsFound: gaps.length,
      candidatesBuilt: candidates.length,
      results,
      sessionId: results.length > 0 ? sessionId : null,
    });
  } catch (error) {
    console.error('[AUTOPILOT-PROCUREMENT] analyze failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to run procurement analysis.', 500);
  }
}

module.exports = { analyze };
