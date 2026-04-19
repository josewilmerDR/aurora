// Pure cash flow aggregator. Produces two monthly series:
//   - history:    accrual-style net per month over the last 12 months
//   - projection: bucketed from events collected by `treasurySources`
//
// "Accrual-style" means we treat operating costs as cash-out on the date they
// were incurred (fecha in planilla/horimetro/cedulas/indirectos) and income
// cash-in on actualCollectionDate when status === 'cobrado'. It's an
// approximation — true cash flow would require a ledger we don't have yet —
// but it's stable, reproducible, and matches the P&L treatment.

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function toISODate(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof v.toDate === 'function') {
    try { return v.toDate().toISOString().slice(0, 10); }
    catch { return ''; }
  }
  return '';
}

// ─── Month helpers ────────────────────────────────────────────────────────

// Inclusive list of 'YYYY-MM' months spanning [from, to].
function monthsInRange(from, to) {
  if (typeof from !== 'string' || typeof to !== 'string') return [];
  if (from.length < 7 || to.length < 7) return [];
  const out = [];
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [yEnd, mEnd] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  if (!Number.isInteger(y) || !Number.isInteger(m)) return [];
  let i = 0;
  while ((y < yEnd || (y === yEnd && m <= mEnd)) && i < 240) {
    out.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    i += 1;
  }
  return out;
}

function bucketEventsByMonth(events, months) {
  const buckets = {};
  for (const m of months) buckets[m] = { month: m, inflows: 0, outflows: 0 };
  for (const ev of events || []) {
    const date = typeof ev?.date === 'string' ? ev.date : '';
    if (date.length < 7) continue;
    const key = date.slice(0, 7);
    const bucket = buckets[key];
    if (!bucket) continue;
    const amt = Number(ev.amount) || 0;
    if (amt <= 0) continue;
    if (ev.type === 'inflow') bucket.inflows += amt;
    else if (ev.type === 'outflow') bucket.outflows += amt;
  }
  return months.map(m => {
    const b = buckets[m];
    return {
      month: m,
      inflows: round2(b.inflows),
      outflows: round2(b.outflows),
      net: round2(b.inflows - b.outflows),
    };
  });
}

// ─── History ──────────────────────────────────────────────────────────────

// Converts raw collections into a flat event list for the historical window.
function buildHistoricalEvents({
  incomeRecords,
  horimetro,
  planillaUnidad,
  planillaFija,
  cedulas,
  costosIndirectos,
  productos,
  range,
}) {
  const { from, to } = range;
  const events = [];
  const prodMap = {};
  for (const p of productos || []) if (p?.id) prodMap[p.id] = p;

  // Income — cash-in when actually collected.
  for (const rec of incomeRecords || []) {
    if (rec?.collectionStatus !== 'cobrado') continue;
    const date = toISODate(rec.actualCollectionDate);
    if (!date || date < from || date > to) continue;
    const amt = Number(rec.totalAmount) || 0;
    if (amt <= 0) continue;
    events.push({ date, amount: amt, type: 'inflow', source: 'income' });
  }

  // Horimetro combustible — cash-out on fecha.
  for (const rec of horimetro || []) {
    const date = toISODate(rec.fecha);
    if (!date || date < from || date > to) continue;
    const amt = Number(rec?.combustible?.costoEstimado) || 0;
    if (amt > 0) events.push({ date, amount: amt, type: 'outflow', source: 'combustible' });
  }

  // Planilla por unidad — cash-out on fecha.
  for (const rec of planillaUnidad || []) {
    const date = toISODate(rec.fecha);
    if (!date || date < from || date > to) continue;
    const amt = Number(rec.totalGeneral) || 0;
    if (amt > 0) events.push({ date, amount: amt, type: 'outflow', source: 'planilla_unidad' });
  }

  // Planilla fija — cash-out on periodoInicio.
  for (const rec of planillaFija || []) {
    const date = toISODate(rec.periodoInicio);
    if (!date || date < from || date > to) continue;
    const amt = Number(rec.totalGeneral) || 0;
    if (amt > 0) events.push({ date, amount: amt, type: 'outflow', source: 'planilla_fija' });
  }

  // Cedulas aplicadas — cash-out for insumos consumed.
  for (const rec of cedulas || []) {
    if (rec?.status !== 'aplicada_en_campo') continue;
    const date = toISODate(rec.aplicadaAt);
    if (!date || date < from || date > to) continue;
    let total = 0;
    for (const p of rec.snap_productos || []) {
      const qty = Number(p?.total) || 0;
      const price = Number(p?.precioUnitario)
        || Number(prodMap[p?.productoId]?.precioUnitario)
        || 0;
      total += qty * price;
    }
    if (total > 0) events.push({ date, amount: total, type: 'outflow', source: 'insumos' });
  }

  // Costos indirectos manuales — cash-out on fecha.
  for (const rec of costosIndirectos || []) {
    const date = toISODate(rec.fecha);
    if (!date || date < from || date > to) continue;
    const amt = Number(rec.monto) || 0;
    if (amt > 0) events.push({ date, amount: amt, type: 'outflow', source: 'indirectos' });
  }

  return events;
}

function buildHistory(rawInputs) {
  const { range } = rawInputs;
  const events = buildHistoricalEvents(rawInputs);
  const months = monthsInRange(range.from, range.to);
  return bucketEventsByMonth(events, months);
}

// ─── Projection ───────────────────────────────────────────────────────────

// Accepts events in the same shape `treasurySources.collectProjectionEvents`
// returns. We don't call it here — the orchestrator does, and passes the
// array so this function stays pure.
function buildProjection({ events, startingBalance, range }) {
  const months = monthsInRange(range.from, range.to);
  const buckets = bucketEventsByMonth(events, months);

  let running = Number(startingBalance) || 0;
  return buckets.map(b => {
    const opening = running;
    running = round2(running + b.net);
    return {
      ...b,
      openingBalance: round2(opening),
      endingBalance: running,
    };
  });
}

// ─── Aggregate ────────────────────────────────────────────────────────────

function buildCashFlow({
  rawHistoryInputs,     // passed straight to buildHistory
  projectionEvents,
  startingBalance,
  projectionRange,
}) {
  const history = buildHistory(rawHistoryInputs);
  const projection = buildProjection({
    events: projectionEvents,
    startingBalance,
    range: projectionRange,
  });

  const historySummary = history.reduce((acc, b) => ({
    inflows: acc.inflows + b.inflows,
    outflows: acc.outflows + b.outflows,
  }), { inflows: 0, outflows: 0 });

  const projectionSummary = projection.reduce((acc, b) => ({
    inflows: acc.inflows + b.inflows,
    outflows: acc.outflows + b.outflows,
  }), { inflows: 0, outflows: 0 });

  const projectionEndingBalance = projection.length > 0
    ? projection[projection.length - 1].endingBalance
    : round2(startingBalance);

  const minProjectedBalance = projection.reduce(
    (min, b) => (b.endingBalance < min ? b.endingBalance : min),
    projection.length > 0 ? projection[0].endingBalance : round2(startingBalance)
  );

  return {
    history: {
      series: history,
      summary: {
        totalInflows: round2(historySummary.inflows),
        totalOutflows: round2(historySummary.outflows),
        netChange: round2(historySummary.inflows - historySummary.outflows),
      },
    },
    projection: {
      series: projection,
      startingBalance: round2(startingBalance),
      summary: {
        totalInflows: round2(projectionSummary.inflows),
        totalOutflows: round2(projectionSummary.outflows),
        endingBalance: projectionEndingBalance,
        minBalance: round2(minProjectedBalance),
      },
    },
  };
}

module.exports = {
  buildCashFlow,
  buildHistory,
  buildProjection,
  buildHistoricalEvents,
  bucketEventsByMonth,
  monthsInRange,
};
