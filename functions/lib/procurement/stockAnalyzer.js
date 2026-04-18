// Pure stock-gap analyzer.
//
// Combines product docs with consumption stats to produce a prioritized list
// of items that need reordering. The suggestion is consumption-aware: we aim
// to cover `leadTimeDays` of demand plus `stockMinimo` as a safety buffer,
// with an extra multiplicative safety factor. Products with no consumption
// history fall back to the classic `stockMinimo - stockActual` rule.
//
// Output shape is meant to feed the procurement agent (phase 2.2) directly —
// each gap exposes everything the OC builder needs plus an `urgency` band.

const DEFAULT_OPTS = Object.freeze({
  leadTimeDays: 14,
  safetyFactor: 1.2,
  // Minimum dollar/unit gap before we report an alert — avoids flapping on
  // products that are essentially at target.
  minGapForAlert: 0.01,
});

const URGENCY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function analyzeStock({ products = [], consumption = {}, opts = {} } = {}) {
  const cfg = { ...DEFAULT_OPTS, ...opts };
  const gaps = [];
  for (const p of products) {
    if (!p || !p.id) continue;
    const gap = buildGap(p, consumption[p.id], cfg);
    if (gap) gaps.push(gap);
  }
  gaps.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);
  return gaps;
}

function buildGap(product, cons, cfg) {
  const stockActual = Number(product.stockActual) || 0;
  const stockMinimo = Number(product.stockMinimo) || 0;
  const weeklyAvg = Number(cons?.weeklyAvg) || 0;
  const dailyAvg = weeklyAvg / 7;
  const daysUntilStockout = dailyAvg > 0 ? stockActual / dailyAvg : null;
  const leadTimeDemand = dailyAvg * cfg.leadTimeDays * cfg.safetyFactor;
  const target = Math.max(stockMinimo, leadTimeDemand + stockMinimo);
  const suggestedQty = round2(Math.max(0, target - stockActual));

  const belowMin = stockActual < stockMinimo;
  const belowLeadTimeCoverage = daysUntilStockout != null
    && daysUntilStockout < cfg.leadTimeDays;
  if (suggestedQty < cfg.minGapForAlert && !belowMin && !belowLeadTimeCoverage) {
    return null;
  }

  return {
    productoId: product.id,
    nombreComercial: product.nombreComercial || '',
    idProducto: product.idProducto || '',
    unidad: product.unidad || '',
    stockActual: round2(stockActual),
    stockMinimo: round2(stockMinimo),
    weeklyConsumption: round4(weeklyAvg),
    daysUntilStockout: daysUntilStockout == null ? null : round2(daysUntilStockout),
    leadTimeDemand: round2(leadTimeDemand),
    suggestedQty,
    urgency: classifyUrgency({ stockActual, stockMinimo, daysUntilStockout, leadTimeDays: cfg.leadTimeDays }),
    reason: buildReason({ stockActual, stockMinimo, weeklyAvg, daysUntilStockout, cfg }),
  };
}

function classifyUrgency({ stockActual, stockMinimo, daysUntilStockout, leadTimeDays }) {
  if (stockActual <= 0) return 'critical';
  if (daysUntilStockout != null) {
    if (daysUntilStockout < leadTimeDays * 0.5) return 'critical';
    if (daysUntilStockout < leadTimeDays) return 'high';
    if (daysUntilStockout < leadTimeDays * 1.5) return 'medium';
  }
  if (stockActual < stockMinimo) return 'medium';
  return 'low';
}

function buildReason({ stockActual, stockMinimo, weeklyAvg, daysUntilStockout, cfg }) {
  if (stockActual <= 0) return 'Stock agotado.';
  if (daysUntilStockout != null) {
    const days = Math.round(daysUntilStockout);
    if (daysUntilStockout < cfg.leadTimeDays) {
      return `Stock cubre ${days} día(s); lead time ${cfg.leadTimeDays} día(s). Consumo semanal ${round2(weeklyAvg)}.`;
    }
    return `Consumo semanal ${round2(weeklyAvg)}; cobertura ${days} día(s).`;
  }
  if (stockActual < stockMinimo) {
    return `Stock (${round2(stockActual)}) por debajo del mínimo (${round2(stockMinimo)}). Sin historial de consumo.`;
  }
  return 'Reorden preventivo sugerido.';
}

function round2(n) { return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function round4(n) { return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0; }

module.exports = {
  analyzeStock,
  DEFAULT_OPTS,
};
