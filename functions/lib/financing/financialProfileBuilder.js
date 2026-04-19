// Orchestrator for Fase 5.1. Given (fincaId, asOf), fetches every collection
// the three aggregators need, pipes raw docs into them, and assembles a full
// financial profile plus a deterministic inputsHash.
//
// All Firestore reads live here; the aggregators stay pure and testable.

const crypto = require('crypto');
const { db } = require('../firebase');
const { buildBalanceSheet } = require('./balanceSheetAggregator');
const { buildIncomeStatement } = require('./incomeStatementAggregator');
const { buildCashFlow } = require('./cashFlowAggregator');
const {
  fetchIncomeInflows,
  fetchPurchaseOrderOutflows,
  fetchFixedPayrollOutflows,
  fetchUnitPayrollOutflows,
} = require('../finance/treasurySources');

// ─── Date helpers ─────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Subtract N months from an ISO 'YYYY-MM-DD' date. Falls back to last day of
// the target month when the day-of-month doesn't exist there.
function addMonthsISO(iso, months) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const total = (y * 12 + (m - 1)) + months;
  const newY = Math.floor(total / 12);
  const newM = (total % 12 + 12) % 12;
  const lastDay = new Date(Date.UTC(newY, newM + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${newY}-${pad2(newM + 1)}-${pad2(day)}`;
}

// Add N days to an ISO date.
function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// ─── Fetches ──────────────────────────────────────────────────────────────

function docs(snap) {
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchAllForFinca(fincaId) {
  const [
    cashBalanceSnap,
    incomeSnap,
    productosSnap,
    maquinariaSnap,
    horimetroSnap,
    ordenesCompraSnap,
    proveedoresSnap,
    planillaUnidadSnap,
    planillaFijaSnap,
    cedulasSnap,
    costosIndirectosSnap,
  ] = await Promise.all([
    db.collection('cash_balance').where('fincaId', '==', fincaId).get(),
    db.collection('income_records').where('fincaId', '==', fincaId).get(),
    db.collection('productos').where('fincaId', '==', fincaId).get(),
    db.collection('maquinaria').where('fincaId', '==', fincaId).get(),
    db.collection('horimetro').where('fincaId', '==', fincaId).get(),
    db.collection('ordenes_compra').where('fincaId', '==', fincaId).get(),
    db.collection('proveedores').where('fincaId', '==', fincaId).get(),
    db.collection('hr_planilla_unidad_historial').where('fincaId', '==', fincaId).get(),
    db.collection('hr_planilla_fijo').where('fincaId', '==', fincaId).get(),
    db.collection('cedulas').where('fincaId', '==', fincaId).get(),
    db.collection('costos_indirectos').where('fincaId', '==', fincaId).get(),
  ]);

  return {
    cashBalanceAll: docs(cashBalanceSnap),
    incomeRecords: docs(incomeSnap),
    productos: docs(productosSnap),
    maquinaria: docs(maquinariaSnap),
    horimetro: docs(horimetroSnap),
    ordenesCompra: docs(ordenesCompraSnap),
    proveedores: docs(proveedoresSnap),
    planillaUnidad: docs(planillaUnidadSnap),
    planillaFija: docs(planillaFijaSnap),
    cedulas: docs(cedulasSnap),
    costosIndirectos: docs(costosIndirectosSnap),
  };
}

// Latest cash_balance doc with dateAsOf ≤ asOf.
function latestCashBalance(cashBalanceAll, asOf) {
  const eligible = (cashBalanceAll || []).filter(c => {
    const d = typeof c.dateAsOf === 'string' ? c.dateAsOf : '';
    return d && d <= asOf;
  });
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => (b.dateAsOf || '').localeCompare(a.dateAsOf || ''));
  return eligible[0];
}

// ─── Inputs hash ──────────────────────────────────────────────────────────

// Fingerprint each doc as `id:updatedAtMs` (falling back to createdAt or 0).
// Captures both presence and in-place mutations without hashing the full doc.
function fpOf(doc) {
  if (!doc || !doc.id) return '';
  const updated = doc.updatedAt?.toMillis?.() ?? 0;
  const created = doc.createdAt?.toMillis?.() ?? 0;
  const ms = updated || created || 0;
  return `${doc.id}:${ms}`;
}

function fpList(collection) {
  return (collection || []).map(fpOf).filter(Boolean).sort();
}

function computeInputsHash(payload) {
  const canonical = {
    asOf: payload.asOf,
    historyRange: payload.historyRange,
    projectionRange: payload.projectionRange,
    cashBalanceFp: payload.cashBalance ? fpOf(payload.cashBalance) : null,
    incomeRecords: fpList(payload.incomeRecords),
    productos: fpList(payload.productos),
    maquinaria: fpList(payload.maquinaria),
    horimetro: fpList(payload.horimetro),
    ordenesCompra: fpList(payload.ordenesCompra),
    planillaUnidad: fpList(payload.planillaUnidad),
    planillaFija: fpList(payload.planillaFija),
    cedulas: fpList(payload.cedulas),
    costosIndirectos: fpList(payload.costosIndirectos),
  };
  const json = JSON.stringify(canonical);
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  return `sha256:${hash}`;
}

// ─── Ranges ───────────────────────────────────────────────────────────────

// asOf defines the "as of" date for the balance sheet. From it we derive:
//   - historyRange:    last 12 months ending at asOf
//   - projectionRange: next 6 months starting the day after asOf
function deriveRanges(asOf) {
  const historyEnd = asOf;
  const historyStart = addMonthsISO(asOf, -12);
  // Projection starts the day AFTER asOf so the month containing asOf isn't
  // double-counted (once in history actuals, once in projection estimates).
  const projectionStart = addDaysISO(asOf, 1);
  const projectionEnd = addMonthsISO(asOf, 6);
  return {
    historyRange: { from: historyStart, to: historyEnd },
    projectionRange: { from: projectionStart, to: projectionEnd },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function buildFinancialProfile(fincaId, { asOf } = {}) {
  const resolvedAsOf = asOf || todayISO();
  const { historyRange, projectionRange } = deriveRanges(resolvedAsOf);

  const raw = await fetchAllForFinca(fincaId);
  const cashBalance = latestCashBalance(raw.cashBalanceAll, resolvedAsOf);

  // Treasury projection events use the existing Fase 1 fetchers, scoped to
  // the projection window. These already read from Firestore internally.
  const [incomeInflows, ocOutflows, fixedOutflows, unitOutflows] = await Promise.all([
    fetchIncomeInflows(fincaId, { fromISO: projectionRange.from, toISO: projectionRange.to }),
    fetchPurchaseOrderOutflows(fincaId, { fromISO: projectionRange.from, toISO: projectionRange.to }),
    fetchFixedPayrollOutflows(fincaId, { fromISO: projectionRange.from, toISO: projectionRange.to }),
    fetchUnitPayrollOutflows(fincaId, { fromISO: projectionRange.from, toISO: projectionRange.to }),
  ]);
  const projectionEvents = [...incomeInflows, ...ocOutflows, ...fixedOutflows, ...unitOutflows];

  const balanceSheet = buildBalanceSheet({
    cashBalance,
    incomeRecords: raw.incomeRecords,
    productos: raw.productos,
    maquinaria: raw.maquinaria,
    horimetroAll: raw.horimetro,
    ordenesCompra: raw.ordenesCompra,
    creditApplications: [], // Fase 5.3 will wire this in.
    asOf: resolvedAsOf,
  });

  const incomeStatement = buildIncomeStatement({
    incomeRecords: raw.incomeRecords,
    horimetro: raw.horimetro,
    planillaUnidad: raw.planillaUnidad,
    planillaFija: raw.planillaFija,
    cedulas: raw.cedulas,
    costosIndirectos: raw.costosIndirectos,
    maquinaria: raw.maquinaria,
    productos: raw.productos,
    range: historyRange,
  });

  const cashFlow = buildCashFlow({
    rawHistoryInputs: {
      incomeRecords: raw.incomeRecords,
      horimetro: raw.horimetro,
      planillaUnidad: raw.planillaUnidad,
      planillaFija: raw.planillaFija,
      cedulas: raw.cedulas,
      costosIndirectos: raw.costosIndirectos,
      productos: raw.productos,
      range: historyRange,
    },
    projectionEvents,
    startingBalance: balanceSheet.assets.cash.amount,
    projectionRange,
  });

  const inputsHash = computeInputsHash({
    asOf: resolvedAsOf,
    historyRange,
    projectionRange,
    cashBalance,
    incomeRecords: raw.incomeRecords,
    productos: raw.productos,
    maquinaria: raw.maquinaria,
    horimetro: raw.horimetro,
    ordenesCompra: raw.ordenesCompra,
    planillaUnidad: raw.planillaUnidad,
    planillaFija: raw.planillaFija,
    cedulas: raw.cedulas,
    costosIndirectos: raw.costosIndirectos,
  });

  const sourceCounts = {
    incomeRecords: raw.incomeRecords.length,
    productos: raw.productos.length,
    maquinaria: raw.maquinaria.length,
    horimetro: raw.horimetro.length,
    ordenesCompra: raw.ordenesCompra.length,
    planillaUnidad: raw.planillaUnidad.length,
    planillaFija: raw.planillaFija.length,
    cedulas: raw.cedulas.length,
    costosIndirectos: raw.costosIndirectos.length,
    cashBalanceDocs: raw.cashBalanceAll.length,
  };

  return {
    fincaId,
    asOf: resolvedAsOf,
    historyRange,
    projectionRange,
    balanceSheet,
    incomeStatement,
    cashFlow,
    inputsHash,
    sourceCounts,
  };
}

module.exports = {
  buildFinancialProfile,
  // exported for tests
  _internals: {
    addMonthsISO,
    addDaysISO,
    deriveRanges,
    latestCashBalance,
    computeInputsHash,
    fpOf,
  },
};
