// Glue between the RFQ close endpoint and Claude.
//
// Composes an `anthropic.messages.create` call using the pure prompt/tool
// builder, hydrates eligible suppliers with historical signals, and returns
// the enriched winner + rationale + captured reasoning.
//
// Failure modes all return null — the caller treats a null result as "use
// the deterministic winner". Nothing here is allowed to throw past the
// top-level try/catch.

const { db } = require('../firebase');
const { getAnthropicClient } = require('../clients');
const { fetchOrdersAndReceptions } = require('../../routes/suppliers/fetchHistory');
const { collectSupplierSignals } = require('./supplierSignals');
const { marketMedianByProduct } = require('./supplierPriceStats');
const { scoreSupplier } = require('./supplierScore');
const { SYSTEM_PROMPT, WINNER_TOOL, buildUserContext } = require('./rfqClaudePrompt');
const { parseClaudeWinner } = require('./rfqClaudeParse');
const { thinkingConfig, MAX_TOKENS_WITH_THINKING, buildReasoning } = require('../autopilotReasoning');

const MODEL = 'claude-sonnet-4-6';

async function reasonAboutRfqWinner({
  rfq,
  deterministicWinner,
  eligibleResponses,
  fincaId,
}) {
  try {
    if (!Array.isArray(eligibleResponses) || eligibleResponses.length === 0) return null;

    const eligibleWithSignals = await hydrateEligibleWithSignals({
      rfq, eligibleResponses, fincaId,
    });
    const userContext = buildUserContext({
      rfq, deterministicWinner, eligibleWithSignals,
    });

    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS_WITH_THINKING,
      thinking: thinkingConfig(),
      system: SYSTEM_PROMPT,
      tools: [WINNER_TOOL],
      messages: [{ role: 'user', content: userContext }],
    });

    const parsed = parseClaudeWinner(response, eligibleResponses);
    if (!parsed) return null;

    return {
      winner: parsed.winner,
      rationale: parsed.rationale,
      reasoning: buildReasoning(response, parsed.toolBlock),
    };
  } catch (err) {
    console.error('[RFQ-CLAUDE] reasoning failed:', err.message);
    return null;
  }
}

async function hydrateEligibleWithSignals({ rfq, eligibleResponses, fincaId }) {
  const [history, suppliersSnap] = await Promise.all([
    fetchOrdersAndReceptions(fincaId),
    db.collection('proveedores').where('fincaId', '==', fincaId).get(),
  ]);
  const suppliersById = new Map(
    suppliersSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }])
  );
  const currency = rfq?.currency || 'USD';
  const market = marketMedianByProduct(history.orders, currency);

  return eligibleResponses.map(response => {
    const supplier = suppliersById.get(response.supplierId);
    let signals = null;
    let score = null;
    if (supplier?.nombre) {
      signals = collectSupplierSignals({
        supplierName: supplier.nombre,
        aliases: Array.isArray(supplier.aliases) ? supplier.aliases : [],
        orders: history.orders,
        receptions: history.receptions,
        currency,
      });
      const scored = scoreSupplier(signals, market, rfq.productoId ? { productoId: rfq.productoId } : {});
      score = scored.score;
    }
    return {
      response,
      signals: signals ? {
        orderCount: signals.orderCount,
        avgLeadTimeDays: signals.avgLeadTimeDays,
        fillRate: signals.fillRate,
      } : {},
      score,
    };
  });
}

module.exports = {
  reasonAboutRfqWinner,
};
