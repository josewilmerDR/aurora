// Pure aggregator for the income statement (P&L) over a historical window.
// Inputs are pre-fetched docs from the orchestrator. Mirrors the grouping
// used by budgets/execution so categories line up with prior reporting.
//
// Revenue counts only non-voided income_records with date in window.
// Costs use the same category map as periodCosts.js but applied on the
// arrays we already fetched for the balance sheet, avoiding a second round
// trip. This is intentional duplication of a few loops, not a reuse
// regression — the balance sheet needs raw records, the P&L needs totals.

const { BUDGET_CATEGORIES } = require('../finance/categories');

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function toISODate(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof v.toDate === 'function') {
    try { return v.toDate().toISOString().slice(0, 10); }
    catch { return ''; }
  }
  return '';
}

function inRange(iso, from, to) {
  return !!iso && iso >= from && iso <= to;
}

function depPerHour(asset) {
  if (!asset) return 0;
  const a = Number(asset.valorAdquisicion);
  const r = Number(asset.valorResidual);
  const h = Number(asset.vidaUtilHoras);
  if (!Number.isFinite(a) || !Number.isFinite(r) || !Number.isFinite(h) || h <= 0) return 0;
  return (a - r) / h;
}

function hoursFromRec(rec) {
  const i = Number(rec?.horimetroInicial);
  const f = Number(rec?.horimetroFinal);
  return (Number.isFinite(i) && Number.isFinite(f) && f >= i) ? f - i : 0;
}

// ─── Revenue ──────────────────────────────────────────────────────────────

function computeRevenue(incomeRecords, { from, to }) {
  let total = 0;
  let count = 0;
  for (const rec of incomeRecords || []) {
    if (rec?.collectionStatus === 'anulado') continue;
    const date = toISODate(rec.date);
    if (!inRange(date, from, to)) continue;
    const amt = Number(rec.totalAmount) || 0;
    if (amt <= 0) continue;
    total += amt;
    count += 1;
  }
  return { amount: round2(total), recordCount: count };
}

// ─── Costs by category ────────────────────────────────────────────────────

function zeroedCategoryMap() {
  const out = {};
  for (const c of BUDGET_CATEGORIES) out[c] = 0;
  return out;
}

function computeCosts({
  horimetro,
  planillaUnidad,
  planillaFija,
  cedulas,
  costosIndirectos,
  maquinaria,
  productos,
  range,
}) {
  const { from, to } = range;
  const totals = zeroedCategoryMap();

  const maqMap = {};
  for (const m of maquinaria || []) {
    if (m?.id) maqMap[m.id] = m;
  }
  const prodMap = {};
  for (const p of productos || []) {
    if (p?.id) prodMap[p.id] = p;
  }

  for (const rec of horimetro || []) {
    const fecha = toISODate(rec.fecha);
    if (!inRange(fecha, from, to)) continue;
    const hours = hoursFromRec(rec);
    totals.combustible += Number(rec?.combustible?.costoEstimado) || 0;
    totals.depreciacion += hours * depPerHour(maqMap[rec.tractorId]);
    totals.depreciacion += hours * depPerHour(maqMap[rec.implementoId]);
  }

  for (const rec of planillaUnidad || []) {
    const fecha = toISODate(rec.fecha);
    if (!inRange(fecha, from, to)) continue;
    totals.planilla_directa += Number(rec.totalGeneral) || 0;
  }

  for (const rec of planillaFija || []) {
    const fecha = toISODate(rec.periodoInicio);
    if (!inRange(fecha, from, to)) continue;
    totals.planilla_fija += Number(rec.totalGeneral) || 0;
  }

  for (const rec of cedulas || []) {
    if (rec?.status !== 'aplicada_en_campo') continue;
    const fecha = toISODate(rec.aplicadaAt);
    if (!inRange(fecha, from, to)) continue;
    const productosSnap = rec.snap_productos || [];
    for (const p of productosSnap) {
      const qty = Number(p?.total) || 0;
      const price = Number(p?.precioUnitario)
        || Number(prodMap[p?.productoId]?.precioUnitario)
        || 0;
      totals.insumos += qty * price;
    }
  }

  for (const rec of costosIndirectos || []) {
    const fecha = toISODate(rec.fecha);
    if (!inRange(fecha, from, to)) continue;
    const cat = rec.categoria || 'otro';
    const amount = Number(rec.monto) || 0;
    if (totals[cat] !== undefined) totals[cat] += amount;
    else totals.otro += amount;
  }

  const rounded = {};
  let totalCosts = 0;
  for (const k of BUDGET_CATEGORIES) {
    const v = round2(totals[k]);
    rounded[k] = v;
    totalCosts += v;
  }

  return { byCategory: rounded, totalCosts: round2(totalCosts) };
}

// ─── Aggregate ────────────────────────────────────────────────────────────

function buildIncomeStatement({
  incomeRecords,
  horimetro,
  planillaUnidad,
  planillaFija,
  cedulas,
  costosIndirectos,
  maquinaria,
  productos,
  range, // { from, to }
}) {
  const revenue = computeRevenue(incomeRecords, range);
  const costs = computeCosts({
    horimetro, planillaUnidad, planillaFija, cedulas,
    costosIndirectos, maquinaria, productos, range,
  });
  const netMargin = round2(revenue.amount - costs.totalCosts);
  const marginRatio = revenue.amount > 0
    ? round2(netMargin / revenue.amount)
    : 0;

  return {
    periodStart: range.from,
    periodEnd: range.to,
    revenue,
    costs,
    netMargin,
    marginRatio,
  };
}

module.exports = {
  buildIncomeStatement,
  computeRevenue,
  computeCosts,
  zeroedCategoryMap,
  // exported for tests
  _internals: { toISODate, inRange, depPerHour, hoursFromRec },
};
