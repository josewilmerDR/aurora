// Supplier scoring — pure combination of signals into a 0-100 grade.
//
// Each signal turns into its own 0-100 subscore. We then take a weighted
// average of the subscores we actually have data for, renormalizing weights
// when a signal is missing. Components with null input are simply skipped.
//
// Inputs
//   - signals: output of `collectSupplierSignals`
//   - marketMedians: output of `marketMedianByProduct` across the whole finca
//   - opts.productoId: when set, price subscore uses ONLY this product
//     (typical "who is best for X" ranking). When unset, price subscore is
//     the quantity-weighted average of the supplier's priceIndex across
//     every product it has ever quoted.
//   - opts.weights / opts.thresholds: overrides
//
// Returns { score: 0-100 | null, breakdown, signals }. score=null means we
// lack enough data to rank this supplier.

const DEFAULT_WEIGHTS = Object.freeze({
  price: 0.35,
  leadTime: 0.25,
  fillRate: 0.25,
  history: 0.15,
});

const DEFAULT_THRESHOLDS = Object.freeze({
  leadTimeCutoffDays: 30,   // leadTime ≥ this → 0 pts
  historyCapOrders: 10,     // orders ≥ this → 100 pts
  priceZeroAtIndex: 1.5,    // 50% above market → 0 pts
});

function scoreSupplier(signals, marketMedians = {}, opts = {}) {
  if (!signals) return emptyResult();
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const thresh = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };

  const priceSub = priceSubscore(signals, marketMedians, opts.productoId, thresh);
  const leadTimeSub = leadTimeSubscore(signals.avgLeadTimeDays, thresh);
  const fillRateSub = fillRateSubscore(signals.fillRate);
  const historySub = historySubscore(signals.orderCount, thresh);

  const components = [
    ['price', priceSub, weights.price],
    ['leadTime', leadTimeSub, weights.leadTime],
    ['fillRate', fillRateSub, weights.fillRate],
    ['history', historySub, weights.history],
  ];

  const present = components.filter(([, v]) => v != null);
  if (present.length === 0) return emptyResult();

  const weightSum = present.reduce((s, [, , w]) => s + w, 0);
  const weighted = present.reduce((s, [, v, w]) => s + v * w, 0);
  const score = weightSum > 0 ? round1(weighted / weightSum) : null;

  const breakdown = {};
  for (const [name, value, weight] of components) {
    breakdown[name] = { value: value == null ? null : round1(value), weight };
  }
  return { score, breakdown, signals };
}

function priceSubscore(signals, marketMedians, productoId, thresh) {
  const prices = signals.pricesByProduct || {};
  const entries = productoId
    ? (prices[productoId] ? [[productoId, prices[productoId]]] : [])
    : Object.entries(prices);
  if (entries.length === 0) return null;

  const spread = Math.max(0.01, thresh.priceZeroAtIndex - 1);
  let weightedSum = 0;
  let weight = 0;
  for (const [key, p] of entries) {
    const market = marketMedians[key]?.median;
    if (!(market > 0) || !(p.avgPrice > 0)) continue;
    const index = p.avgPrice / market;
    const sub = clamp(50 + (1 - index) * (50 / spread), 0, 100);
    const w = p.sampleCount || 1;
    weightedSum += sub * w;
    weight += w;
  }
  if (weight === 0) return null;
  return weightedSum / weight;
}

function leadTimeSubscore(avgDays, thresh) {
  if (avgDays == null) return null;
  const d = Math.max(0, Number(avgDays));
  return clamp(100 * (1 - d / thresh.leadTimeCutoffDays), 0, 100);
}

function fillRateSubscore(rate) {
  if (rate == null) return null;
  return clamp(100 * Number(rate), 0, 100);
}

function historySubscore(orderCount, thresh) {
  if (!orderCount || orderCount <= 0) return null;
  return clamp(100 * (orderCount / thresh.historyCapOrders), 0, 100);
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function round1(n) { return Math.round(n * 10) / 10; }

function emptyResult() {
  return {
    score: null,
    breakdown: {
      price: { value: null, weight: DEFAULT_WEIGHTS.price },
      leadTime: { value: null, weight: DEFAULT_WEIGHTS.leadTime },
      fillRate: { value: null, weight: DEFAULT_WEIGHTS.fillRate },
      history: { value: null, weight: DEFAULT_WEIGHTS.history },
    },
    signals: null,
  };
}

module.exports = {
  scoreSupplier,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
};
