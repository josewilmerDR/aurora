// Fase 6.0 — Meta state builder.
//
// Produces a single, reproducible "FincaState" snapshot that aggregates the
// observable state of all five autonomy domains (finance, procurement, hr,
// strategy, financing). The orchestrator of Fase 6.1 will consume this as
// its input; downstream KPI sweeps (6.2) and trust computations (6.3) will
// anchor their evaluations against these snapshots.
//
// Design contract:
//
//   - All Firestore reads happen here. Per-domain aggregation libs stay
//     pure (same split as `financialProfileBuilder` in Fase 5.1).
//   - Output is deterministic given the same input docs: same inputs →
//     same `inputsHash` (sha256 fingerprint). This lets the orchestrator
//     short-circuit when nothing has changed.
//   - Never calls Claude and never persists `autopilot_actions`. This is
//     pure observation — the orchestrator decides what to do with it.
//   - Never fails "partially": a missing domain fetch is caught and the
//     corresponding section is emitted as `{ error: '...', data: null }`
//     so the orchestrator can still work with the rest.

const crypto = require('crypto');
const { db } = require('../firebase');

const { periodToDateRange } = require('../finance/periodRange');
const { computePeriodCosts } = require('../finance/periodCosts');
const { buildExecutionReport } = require('../finance/budgetConsumption');
const { buildWeeklyProjection } = require('../finance/projection');
const {
  fetchLatestCashBalance,
  collectProjectionEvents,
} = require('../finance/treasurySources');
const { toISO, addDays, parseISO } = require('../finance/weekRanges');

const { weeklyConsumptionByProduct } = require('../procurement/consumptionStats');
const { analyzeStock } = require('../procurement/stockAnalyzer');

const { projectWorkload } = require('../hr/workloadProjector');
const { currentCapacity } = require('../hr/capacityCalculator');

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_HORIZON_WEEKS = 4;
const DEFAULT_LOOKBACK_WEEKS = 8;
const DEFAULT_SIGNAL_WINDOW_DAYS = 14;
const DEFAULT_LEAD_TIME_DAYS = 14;
const DEFAULT_SAFETY_FACTOR = 1.2;
const HR_WORKLOAD_HORIZON_WEEKS = 12;
const RECENT_SIGNALS_LIMIT = 10;
const URGENCIES = ['critical', 'high', 'medium', 'low'];

// ── Date helpers ────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

function todayISO(now) {
  const d = now instanceof Date ? now : new Date();
  return d.toISOString().slice(0, 10);
}

function currentMonthPeriod(now) {
  const d = now instanceof Date ? now : new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function previousMonthPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  return `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}`;
}

function addDaysISO(iso, days) {
  const dt = parseISO(iso);
  if (!dt) return iso;
  return toISO(addDays(dt, days));
}

// ── Raw fetch ───────────────────────────────────────────────────────────────

function docs(snap) {
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Last N days worth of `external_signals`, newest first. Bounded by
// `RECENT_SIGNALS_LIMIT` to keep the snapshot compact. We read by
// `observedAt` to mirror the field used at ingestion.
async function fetchRecentSignals(fincaId, now, windowDays, limit) {
  const cutoffMs = now.getTime() - windowDays * 86400000;
  const snap = await db.collection('external_signals')
    .where('fincaId', '==', fincaId)
    .orderBy('observedAt', 'desc')
    .limit(limit)
    .get();
  const out = [];
  for (const d of snap.docs) {
    const data = d.data();
    const observedMs = data.observedAt?.toMillis?.() ?? 0;
    if (observedMs && observedMs < cutoffMs) continue;
    out.push({ id: d.id, ...data });
  }
  return out;
}

async function fetchActiveAnnualPlan(fincaId, year) {
  const snap = await db.collection('annual_plans')
    .where('fincaId', '==', fincaId)
    .where('year', '==', year)
    .where('isActive', '==', true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function fetchLastDebtSimulation(fincaId) {
  const snap = await db.collection('debt_simulations')
    .where('fincaId', '==', fincaId)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function fetchPerformanceScores(fincaId, period) {
  const snap = await db.collection('hr_performance_scores')
    .where('fincaId', '==', fincaId)
    .where('period', '==', period)
    .get();
  return docs(snap);
}

async function fetchMovimientosSince(fincaId, cutoff) {
  const { Timestamp } = require('../firebase');
  const snap = await db.collection('movimientos')
    .where('fincaId', '==', fincaId)
    .where('fecha', '>=', Timestamp.fromDate(cutoff))
    .orderBy('fecha', 'desc')
    .get();
  return snap.docs.map(d => {
    const data = d.data();
    return { id: d.id, ...data, fecha: data.fecha?.toDate?.() || null };
  });
}

async function fetchBudgetsForPeriod(fincaId, period) {
  const snap = await db.collection('budgets')
    .where('fincaId', '==', fincaId)
    .where('period', '==', period)
    .get();
  return docs(snap);
}

// ── Aggregation wrappers ────────────────────────────────────────────────────

// Each wrapper is `safe()` — if any step throws, we emit `{error, data:null}`
// instead of propagating. This keeps a broken domain from taking down the
// whole snapshot.
async function safe(name, fn) {
  try {
    return { data: await fn(), error: null };
  } catch (err) {
    console.error(`[META] ${name} failed:`, err);
    return { data: null, error: err.message || String(err) };
  }
}

// ── Finance section ─────────────────────────────────────────────────────────

function summarizeExecution(rows) {
  let totalAssigned = 0;
  let totalExecuted = 0;
  let overBudgetCount = 0;
  for (const r of rows) {
    totalAssigned += Number(r.assignedAmount) || 0;
    totalExecuted += Number(r.executedAmount) || 0;
    if (r.overBudget) overBudgetCount += 1;
  }
  const overallPercent = totalAssigned > 0
    ? Math.round((totalExecuted / totalAssigned) * 10000) / 100
    : null;
  return {
    overBudgetCount,
    totalAssigned: round2(totalAssigned),
    totalExecuted: round2(totalExecuted),
    overallPercent,
  };
}

async function buildFinanceSection(fincaId, period, horizonWeeks, asOf) {
  const range = periodToDateRange(period);
  if (!range) throw new Error(`Invalid period: ${period}`);

  const [budgets, periodCosts, cashBalance] = await Promise.all([
    fetchBudgetsForPeriod(fincaId, period),
    computePeriodCosts(fincaId, range),
    fetchLatestCashBalance(fincaId),
  ]);

  const rows = buildExecutionReport(budgets, periodCosts);

  // Projection window: from the day after the latest cash balance (or today
  // if none), forward `horizonWeeks`.
  const startingDate = cashBalance?.dateAsOf && cashBalance.dateAsOf <= asOf
    ? cashBalance.dateAsOf
    : asOf;
  const projectionStart = startingDate;
  const projectionEnd = addDaysISO(projectionStart, horizonWeeks * 7);

  const events = await collectProjectionEvents(fincaId, {
    fromISO: projectionStart,
    toISO: projectionEnd,
  });

  const proj = buildWeeklyProjection({
    startingBalance: cashBalance ? Number(cashBalance.amount) || 0 : 0,
    startingDate: projectionStart,
    events,
    weeks: horizonWeeks,
  });

  return {
    budgetExecution: {
      period,
      rows,
      summary: summarizeExecution(rows),
    },
    cashProjection: {
      horizonWeeks,
      startingBalance: proj.startingBalance,
      startingDate: proj.startingDate,
      projectedEndBalance: proj.summary?.endingBalance ?? proj.startingBalance,
      minBalance: proj.summary?.minBalance ?? proj.startingBalance,
      minBalanceDate: proj.summary?.minBalanceDate ?? proj.startingDate,
      negativeWeeks: proj.summary?.negativeWeeks ?? 0,
      totalInflows: proj.summary?.totalInflows ?? 0,
      totalOutflows: proj.summary?.totalOutflows ?? 0,
      currency: cashBalance?.currency || 'USD',
    },
    _inputs: {
      budgets,
      cashBalance,
      projectionEvents: events,
    },
  };
}

// ── Procurement section ─────────────────────────────────────────────────────

async function buildProcurementSection(fincaId, now, lookbackWeeks) {
  const cutoff = new Date(now.getTime() - lookbackWeeks * 7 * 86400000);

  const [productsSnap, movimientos] = await Promise.all([
    db.collection('productos').where('fincaId', '==', fincaId).get(),
    fetchMovimientosSince(fincaId, cutoff),
  ]);
  const products = docs(productsSnap);

  const consumption = weeklyConsumptionByProduct(movimientos, { now, lookbackWeeks });
  const gaps = analyzeStock({
    products,
    consumption,
    opts: { leadTimeDays: DEFAULT_LEAD_TIME_DAYS, safetyFactor: DEFAULT_SAFETY_FACTOR },
  });

  const gapsByUrgency = {};
  for (const u of URGENCIES) gapsByUrgency[u] = 0;
  for (const g of gaps) {
    if (gapsByUrgency[g.urgency] != null) gapsByUrgency[g.urgency] += 1;
  }

  // Trim each gap to a compact shape — enough for the orchestrator to
  // reason, without duplicating the full analyzer output in the snapshot.
  const stockGaps = gaps.slice(0, 50).map(g => ({
    productoId: g.productoId,
    nombreComercial: g.nombreComercial,
    stockActual: g.stockActual,
    stockMinimo: g.stockMinimo,
    suggestedQty: g.suggestedQty,
    urgency: g.urgency,
  }));

  return {
    stockGaps,
    gapsByUrgency,
    gapCount: gaps.length,
    lookbackWeeks,
    _inputs: { products, movimientos },
  };
}

// ── HR section ──────────────────────────────────────────────────────────────

function avgScore(scores) {
  const valid = [];
  for (const s of scores || []) {
    if (!s || s.score == null) continue;
    const n = Number(s.score);
    if (Number.isFinite(n)) valid.push(n);
  }
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, n) => acc + n, 0);
  return Math.round((sum / valid.length) * 100) / 100;
}

async function buildHrSection(fincaId, now, period, horizonWeeks) {
  const prevPeriod = previousMonthPeriod(period);

  const [siembrasSnap, packagesSnap, fichasSnap, scoresCurrent, scoresPrev] = await Promise.all([
    db.collection('siembras').where('fincaId', '==', fincaId).get(),
    db.collection('packages').where('fincaId', '==', fincaId).get(),
    db.collection('hr_fichas').where('fincaId', '==', fincaId).get(),
    fetchPerformanceScores(fincaId, period),
    fetchPerformanceScores(fincaId, prevPeriod),
  ]);

  const siembras = docs(siembrasSnap);
  const packages = docs(packagesSnap);
  const fichas = docs(fichasSnap);

  const workload = projectWorkload({ siembras, packages, horizonWeeks, now });
  const capacity = currentCapacity(fichas);

  // Peak week = the week with the highest demandedWorkers; ties broken by
  // estimatedPersonHours. A quick read of "where the pressure is highest".
  const peakWeek = workload.weeks.reduce((best, w) => {
    if (!best) return w;
    if (w.demandedWorkers > best.demandedWorkers) return w;
    if (w.demandedWorkers === best.demandedWorkers && w.estimatedPersonHours > best.estimatedPersonHours) return w;
    return best;
  }, null);

  const current = avgScore(scoresCurrent);
  const previous = avgScore(scoresPrev);
  const delta = (current != null && previous != null)
    ? Math.round((current - previous) * 100) / 100
    : null;

  return {
    workloadProjection: {
      horizonWeeks: workload.horizonWeeks,
      totalActivities: workload.summary?.totalActivitiesScheduled ?? 0,
      estimatedPersonHoursTotal: workload.summary?.estimatedPersonHoursTotal ?? 0,
      peakWeek: peakWeek ? {
        weekStart: peakWeek.weekStart,
        estimatedPersonHours: peakWeek.estimatedPersonHours,
        demandedWorkers: peakWeek.demandedWorkers,
      } : null,
    },
    capacity: {
      baselineWeeklyHours: capacity.baselineWeeklyHours,
      permanentCount: capacity.permanentCount,
      avgWeeklyHoursPermanent: capacity.avgWeeklyHoursPermanent,
    },
    performanceTrend: {
      currentPeriod: period,
      previousPeriod: prevPeriod,
      avgScoreCurrent: current,
      avgScorePrevious: previous,
      delta,
      sampleSizeCurrent: scoresCurrent.length,
      sampleSizePrevious: scoresPrev.length,
    },
    _inputs: { siembras, packages, fichas, scoresCurrent, scoresPrev },
  };
}

// ── Strategy section ────────────────────────────────────────────────────────

async function buildStrategySection(fincaId, now) {
  const year = now.getUTCFullYear();
  const [activeAnnualPlan, recentSignals] = await Promise.all([
    fetchActiveAnnualPlan(fincaId, year),
    fetchRecentSignals(fincaId, now, DEFAULT_SIGNAL_WINDOW_DAYS, RECENT_SIGNALS_LIMIT),
  ]);

  return {
    activeAnnualPlan: activeAnnualPlan ? {
      id: activeAnnualPlan.id,
      year: activeAnnualPlan.year,
      version: activeAnnualPlan.version,
      status: activeAnnualPlan.status,
      isActive: activeAnnualPlan.isActive === true,
      activatedAt: activeAnnualPlan.activatedAt?.toDate?.()?.toISOString?.() || null,
    } : null,
    recentSignals: recentSignals.map(s => ({
      id: s.id,
      signalType: s.signalType,
      value: s.value,
      unit: s.unit,
      confidence: s.confidence,
      observedAt: s.observedAt?.toDate?.()?.toISOString?.() || null,
    })),
    signalWindowDays: DEFAULT_SIGNAL_WINDOW_DAYS,
    _inputs: { activeAnnualPlan, recentSignals },
  };
}

// ── Financing section ───────────────────────────────────────────────────────

async function buildFinancingSection(fincaId) {
  const last = await fetchLastDebtSimulation(fincaId);
  return {
    lastDebtSimulation: last ? {
      id: last.id,
      createdAt: last.createdAt?.toDate?.()?.toISOString?.() || null,
      creditProductId: last.creditProductId || null,
      creditProductName: last.creditProductName || null,
      amount: last.amount ?? null,
      plazoMeses: last.plazoMeses ?? null,
      recommendation: last.recommendation?.decision ?? null,
    } : null,
    _inputs: { lastDebtSimulation: last },
  };
}

// ── Inputs hash ─────────────────────────────────────────────────────────────

// Fingerprint each doc as `id:updatedAtMs` (falling back to createdAt, then 0).
// Mirrors the pattern used in `financialProfileBuilder.fpOf` of Fase 5.1.
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

// Projection events come from an opaque aggregator (`collectProjectionEvents`).
// We hash a canonical JSON of them directly — same source docs produce the
// same events, so the hash still tracks source mutations transitively.
function fpProjectionEvents(events) {
  const safe = (events || []).map(e => ({
    source: e.source || '',
    date: e.date || '',
    type: e.type || '',
    amount: Math.round((Number(e.amount) || 0) * 100) / 100,
    label: e.label || '',
  }));
  safe.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.label.localeCompare(b.label);
  });
  return safe;
}

function computeInputsHash(payload) {
  const canonical = {
    asOf: payload.asOf,
    period: payload.period,
    horizonWeeks: payload.horizonWeeks,
    lookbackWeeks: payload.lookbackWeeks,
    budgets: fpList(payload.budgets),
    productos: fpList(payload.productos),
    movimientos: fpList(payload.movimientos),
    siembras: fpList(payload.siembras),
    packages: fpList(payload.packages),
    fichas: fpList(payload.fichas),
    scoresCurrent: fpList(payload.scoresCurrent),
    scoresPrev: fpList(payload.scoresPrev),
    cashBalanceFp: payload.cashBalance ? fpOf(payload.cashBalance) : null,
    activeAnnualPlanFp: payload.activeAnnualPlan ? fpOf(payload.activeAnnualPlan) : null,
    recentSignals: fpList(payload.recentSignals),
    lastDebtSimulationFp: payload.lastDebtSimulation ? fpOf(payload.lastDebtSimulation) : null,
    projectionEvents: fpProjectionEvents(payload.projectionEvents),
  };
  const json = JSON.stringify(canonical);
  return `sha256:${crypto.createHash('sha256').update(json).digest('hex')}`;
}

// ── Utility ─────────────────────────────────────────────────────────────────

function round2(n) {
  if (!Number.isFinite(Number(n))) return 0;
  return Math.round(Number(n) * 100) / 100;
}

function stripInputs(section) {
  if (!section || !section.data) return section;
  const { _inputs, ...rest } = section.data;
  return { data: rest, error: section.error };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function buildFincaState(fincaId, options = {}) {
  if (!fincaId || typeof fincaId !== 'string') {
    throw new Error('fincaId is required.');
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const asOf = options.asOf || todayISO(now);
  const period = options.period || currentMonthPeriod(now);
  const horizonWeeks = Number.isFinite(Number(options.horizonWeeks))
    ? Math.max(1, Math.min(26, Math.floor(Number(options.horizonWeeks))))
    : DEFAULT_HORIZON_WEEKS;
  const lookbackWeeks = Number.isFinite(Number(options.lookbackWeeks))
    ? Math.max(1, Math.min(52, Math.floor(Number(options.lookbackWeeks))))
    : DEFAULT_LOOKBACK_WEEKS;

  const [finance, procurement, hr, strategy, financing] = await Promise.all([
    safe('finance', () => buildFinanceSection(fincaId, period, horizonWeeks, asOf)),
    safe('procurement', () => buildProcurementSection(fincaId, now, lookbackWeeks)),
    safe('hr', () => buildHrSection(fincaId, now, period, HR_WORKLOAD_HORIZON_WEEKS)),
    safe('strategy', () => buildStrategySection(fincaId, now)),
    safe('financing', () => buildFinancingSection(fincaId)),
  ]);

  const hashPayload = {
    asOf, period, horizonWeeks, lookbackWeeks,
    budgets: finance.data?._inputs?.budgets || [],
    cashBalance: finance.data?._inputs?.cashBalance || null,
    projectionEvents: finance.data?._inputs?.projectionEvents || [],
    productos: procurement.data?._inputs?.products || [],
    movimientos: procurement.data?._inputs?.movimientos || [],
    siembras: hr.data?._inputs?.siembras || [],
    packages: hr.data?._inputs?.packages || [],
    fichas: hr.data?._inputs?.fichas || [],
    scoresCurrent: hr.data?._inputs?.scoresCurrent || [],
    scoresPrev: hr.data?._inputs?.scoresPrev || [],
    activeAnnualPlan: strategy.data?._inputs?.activeAnnualPlan || null,
    recentSignals: strategy.data?._inputs?.recentSignals || [],
    lastDebtSimulation: financing.data?._inputs?.lastDebtSimulation || null,
  };

  const inputsHash = computeInputsHash(hashPayload);

  const sourceCounts = {
    budgets: hashPayload.budgets.length,
    productos: hashPayload.productos.length,
    movimientos: hashPayload.movimientos.length,
    siembras: hashPayload.siembras.length,
    packages: hashPayload.packages.length,
    fichas: hashPayload.fichas.length,
    scoresCurrent: hashPayload.scoresCurrent.length,
    scoresPrev: hashPayload.scoresPrev.length,
    projectionEvents: hashPayload.projectionEvents.length,
    recentSignals: hashPayload.recentSignals.length,
    cashBalancePresent: !!hashPayload.cashBalance,
    activeAnnualPlanPresent: !!hashPayload.activeAnnualPlan,
    lastDebtSimulationPresent: !!hashPayload.lastDebtSimulation,
  };

  const errors = {};
  for (const [k, v] of Object.entries({ finance, procurement, hr, strategy, financing })) {
    if (v.error) errors[k] = v.error;
  }

  return {
    fincaId,
    asOf,
    period,
    horizonWeeks,
    lookbackWeeks,
    finance: stripInputs(finance).data,
    procurement: stripInputs(procurement).data,
    hr: stripInputs(hr).data,
    strategy: stripInputs(strategy).data,
    financing: stripInputs(financing).data,
    inputsHash,
    sourceCounts,
    errors: Object.keys(errors).length > 0 ? errors : null,
  };
}

module.exports = {
  buildFincaState,
  _internals: {
    currentMonthPeriod,
    previousMonthPeriod,
    addDaysISO,
    summarizeExecution,
    avgScore,
    fpOf,
    fpList,
    fpProjectionEvents,
    computeInputsHash,
    DEFAULT_HORIZON_WEEKS,
    DEFAULT_LOOKBACK_WEEKS,
    HR_WORKLOAD_HORIZON_WEEKS,
    RECENT_SIGNALS_LIMIT,
  },
};
