// Pure winner picker for RFQ responses.
//
// v1 rule: among responses marked available with a positive unit price and
// a lead time within the required window, pick the cheapest. Ties break on
// shortest lead time, then on most recent response.
//
// Input
//   responses[]: [{ supplierId, supplierName, precioUnitario, disponible,
//                   leadTimeDays, respondedAt, moneda? }]
//   opts.maxLeadTimeDays: reject responses whose leadTime exceeds this
//   opts.currency:        if set, responses with a different moneda are rejected
//
// Output
//   { winner, rankedEligible, rejected } — winner is null when nothing eligible.
//   Each rejected entry carries a `reason` string.

function pickWinner(responses = [], opts = {}) {
  const cfg = {
    maxLeadTimeDays: null,
    currency: null,
    ...opts,
  };

  const eligible = [];
  const rejected = [];
  for (const r of responses) {
    const reason = disqualify(r, cfg);
    if (reason) {
      rejected.push({ ...r, reason });
    } else {
      eligible.push(r);
    }
  }

  eligible.sort(compareEligible);
  return {
    winner: eligible[0] || null,
    rankedEligible: eligible,
    rejected,
  };
}

function disqualify(r, cfg) {
  if (!r) return 'Respuesta vacía.';
  if (r.disponible === false) return 'Proveedor marcó el producto como no disponible.';
  const price = Number(r.precioUnitario);
  if (!(price > 0)) return 'Precio unitario no válido.';
  const leadTime = Number(r.leadTimeDays);
  if (!Number.isFinite(leadTime) || leadTime < 0) return 'Lead time no válido.';
  if (cfg.maxLeadTimeDays != null && leadTime > cfg.maxLeadTimeDays) {
    return `Lead time ${leadTime}d excede el máximo solicitado (${cfg.maxLeadTimeDays}d).`;
  }
  if (cfg.currency && r.moneda && r.moneda !== cfg.currency) {
    return `Moneda ${r.moneda} no coincide con la solicitada (${cfg.currency}).`;
  }
  return null;
}

function compareEligible(a, b) {
  const priceDiff = Number(a.precioUnitario) - Number(b.precioUnitario);
  if (priceDiff !== 0) return priceDiff;
  const leadDiff = Number(a.leadTimeDays) - Number(b.leadTimeDays);
  if (leadDiff !== 0) return leadDiff;
  const ta = toEpoch(a.respondedAt);
  const tb = toEpoch(b.respondedAt);
  return tb - ta; // most recent first
}

function toEpoch(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

module.exports = {
  pickWinner,
};
