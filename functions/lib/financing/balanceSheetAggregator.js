// Pure aggregator for the balance sheet (activos / pasivos / patrimonio).
// All inputs are plain arrays of Firestore docs already fetched by the
// orchestrator. No DB calls live here.
//
// Convention: every monetary amount is returned rounded to 2 decimals.
// All dates are ISO 'YYYY-MM-DD' strings, comparable lexicographically.

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Depreciation per hour for a maquinaria asset. Mirrors the heuristic used in
// periodCosts.js / loteCostTotals.js so the numbers match what ROI reports.
function depreciationPerHour(asset) {
  if (!asset) return 0;
  const a = Number(asset.valorAdquisicion);
  const r = Number(asset.valorResidual);
  const h = Number(asset.vidaUtilHoras);
  if (!Number.isFinite(a) || !Number.isFinite(r) || !Number.isFinite(h) || h <= 0) return 0;
  return (a - r) / h;
}

function hoursFromRecord(rec) {
  const i = Number(rec?.horimetroInicial);
  const f = Number(rec?.horimetroFinal);
  return (Number.isFinite(i) && Number.isFinite(f) && f >= i) ? f - i : 0;
}

// ─── Assets ───────────────────────────────────────────────────────────────

// Accounts receivable: pending income_records with date ≤ asOf.
function computeAccountsReceivable(incomeRecords, asOf) {
  let amount = 0;
  let count = 0;
  for (const rec of incomeRecords || []) {
    if (rec?.collectionStatus !== 'pendiente') continue;
    const date = typeof rec.date === 'string' ? rec.date : '';
    if (!date || date > asOf) continue;
    const amt = Number(rec.totalAmount) || 0;
    if (amt <= 0) continue;
    amount += amt;
    count += 1;
  }
  return { amount: round2(amount), invoiceCount: count };
}

// Inventory valuation: sum of stockActual × precioUnitario per producto.
// Items without `precioUnitario` are skipped and surfaced as a note so the
// user knows the number undercounts reality.
function computeInventory(productos) {
  let amount = 0;
  let valued = 0;
  let missingPrice = 0;
  for (const p of productos || []) {
    const stock = Number(p?.stockActual) || 0;
    if (stock <= 0) continue;
    const price = Number(p?.precioUnitario);
    if (!Number.isFinite(price) || price <= 0) {
      missingPrice += 1;
      continue;
    }
    amount += stock * price;
    valued += 1;
  }
  return {
    amount: round2(amount),
    itemCount: valued,
    itemsWithoutPrice: missingPrice,
  };
}

// Accumulated depreciation per asset = min(totalHours × depPerHour, gross - residual).
// Caps at depreciable base so the book value never drops below valorResidual.
function computeFixedAssets(maquinaria, horimetroAll, asOf) {
  const hoursByAsset = {};
  for (const rec of horimetroAll || []) {
    const fecha = typeof rec?.fecha === 'string' ? rec.fecha : '';
    if (!fecha || fecha > asOf) continue;
    const hours = hoursFromRecord(rec);
    if (hours <= 0) continue;
    if (rec.tractorId) hoursByAsset[rec.tractorId] = (hoursByAsset[rec.tractorId] || 0) + hours;
    if (rec.implementoId) hoursByAsset[rec.implementoId] = (hoursByAsset[rec.implementoId] || 0) + hours;
  }

  let grossValue = 0;
  let accumulatedDepreciation = 0;
  let assetCount = 0;
  for (const asset of maquinaria || []) {
    const gross = Number(asset?.valorAdquisicion) || 0;
    if (gross <= 0) continue;
    assetCount += 1;
    grossValue += gross;

    const residual = Math.max(0, Number(asset?.valorResidual) || 0);
    const depreciableBase = Math.max(0, gross - residual);
    const hours = hoursByAsset[asset.id] || 0;
    const dep = Math.min(hours * depreciationPerHour(asset), depreciableBase);
    accumulatedDepreciation += dep;
  }

  const netBookValue = grossValue - accumulatedDepreciation;
  return {
    grossValue: round2(grossValue),
    accumulatedDepreciation: round2(accumulatedDepreciation),
    netBookValue: round2(netBookValue),
    assetCount,
  };
}

// ─── Liabilities ──────────────────────────────────────────────────────────

// Open purchase orders as of `asOf` — anything not paid/cancelled/voided and
// emitted on or before asOf is treated as a current payable.
function computeAccountsPayable(ordenesCompra, asOf) {
  const CLOSED = new Set(['pagada', 'cancelada', 'anulada']);
  let amount = 0;
  let count = 0;
  for (const oc of ordenesCompra || []) {
    const estado = oc?.estado || '';
    if (CLOSED.has(estado)) continue;
    const fechaEmision = typeof oc.fechaEmision === 'string' ? oc.fechaEmision : '';
    if (fechaEmision && fechaEmision > asOf) continue;

    const items = Array.isArray(oc.items) ? oc.items : [];
    const total = items.reduce((s, it) => {
      const qty = Number(it?.cantidad) || 0;
      const price = Number(it?.precioUnitario) || 0;
      return s + qty * price;
    }, 0);
    if (total <= 0) continue;
    amount += total;
    count += 1;
  }
  return { amount: round2(amount), orderCount: count };
}

// Debt obligations from credit_applications approved but not fully repaid.
// Fase 5.1: no credit_applications yet → always zero. Explicit so the shape
// is stable and 5.3 can drop in later without schema migration.
function computeDebtObligations(creditApplications) {
  let amount = 0;
  let count = 0;
  for (const app of creditApplications || []) {
    if (app?.status !== 'approved' && app?.status !== 'active') continue;
    const outstanding = Number(app?.outstandingBalance) || Number(app?.approvedAmount) || 0;
    if (outstanding <= 0) continue;
    amount += outstanding;
    count += 1;
  }
  return { amount: round2(amount), count };
}

// ─── Aggregate ────────────────────────────────────────────────────────────

function buildBalanceSheet({
  cashBalance,
  incomeRecords,
  productos,
  maquinaria,
  horimetroAll,
  ordenesCompra,
  creditApplications,
  asOf,
}) {
  const notes = [];

  // Cash: latest cash_balance with dateAsOf ≤ asOf. The orchestrator selects it;
  // here we just reflect what it passed. `amount` 0 is valid (no records yet).
  const cashAmount = Number(cashBalance?.amount) || 0;
  if (!cashBalance) notes.push('NO_CASH_BALANCE_RECORD');

  const accountsReceivable = computeAccountsReceivable(incomeRecords, asOf);
  const inventory = computeInventory(productos);
  if (inventory.itemsWithoutPrice > 0) {
    notes.push(`INVENTORY_MISSING_PRICE:${inventory.itemsWithoutPrice}`);
  }

  const fixedAssets = computeFixedAssets(maquinaria, horimetroAll, asOf);
  const accountsPayable = computeAccountsPayable(ordenesCompra, asOf);
  const debtObligations = computeDebtObligations(creditApplications);

  const totalAssets = round2(
    cashAmount + accountsReceivable.amount + inventory.amount + fixedAssets.netBookValue
  );
  const totalLiabilities = round2(accountsPayable.amount + debtObligations.amount);
  const totalEquity = round2(totalAssets - totalLiabilities);

  return {
    asOf,
    assets: {
      cash: {
        amount: round2(cashAmount),
        dateAsOf: cashBalance?.dateAsOf || null,
      },
      accountsReceivable,
      inventory: { amount: inventory.amount, itemCount: inventory.itemCount },
      fixedAssets,
      totalAssets,
    },
    liabilities: {
      accountsPayable,
      debtObligations,
      totalLiabilities,
    },
    equity: {
      totalEquity,
    },
    notes,
  };
}

module.exports = {
  buildBalanceSheet,
  computeAccountsReceivable,
  computeInventory,
  computeFixedAssets,
  computeAccountsPayable,
  computeDebtObligations,
  depreciationPerHour,
  hoursFromRecord,
};
