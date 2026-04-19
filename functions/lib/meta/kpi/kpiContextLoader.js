// KPI context loader — Fase 6.2. Impure (Firestore reads).
//
// Given a `source` (autopilot_actions doc or meta_orchestrator_runs doc)
// and its template, fetches everything the template's `evaluate()` needs
// to produce an observation. The template declares its needs via
// `requiredContext`; this loader has one branch per key and skips the
// work when a key isn't requested.
//
// Evaluation lives in `kpiTemplates.evaluate()` (pure); loading lives
// here. This split keeps the templates fully unit-testable without a
// Firestore emulator.

const { db } = require('../../firebase');
const { periodToDateRange } = require('../../finance/periodRange');
const { computePeriodCosts } = require('../../finance/periodCosts');
const { buildFincaState } = require('../fincaStateBuilder');
const { detectSignals } = require('../orchestrator/signalDetector');

const CHUNK_SIZE = 10; // Firestore `in` query limit

// ── Helpers ─────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

function currentMonthPeriod(now) {
  const d = now instanceof Date ? now : new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

// Firestore `where in [...]` caps at 10. Chunk + merge.
async function fetchManyByIds(collection, ids) {
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  if (unique.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    chunks.push(unique.slice(i, i + CHUNK_SIZE));
  }
  const results = [];
  for (const chunk of chunks) {
    const refs = chunk.map(id => db.collection(collection).doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) results.push({ id: snap.id, ...snap.data() });
    }
  }
  return results;
}

// ── Per-template loaders ────────────────────────────────────────────────────

async function loadSourceBudget(action) {
  const id = action?.params?.sourceBudgetId;
  if (!id) return null;
  const snap = await db.collection('budgets').doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function loadSourceExecution(action, fincaId, period) {
  const sourceBudgetId = action?.params?.sourceBudgetId;
  if (!sourceBudgetId) return null;
  const budgetSnap = await db.collection('budgets').doc(sourceBudgetId).get();
  if (!budgetSnap.exists) return null;
  const category = budgetSnap.data().category;
  if (!category) return null;
  const range = periodToDateRange(period);
  if (!range) return null;
  const costs = await computePeriodCosts(fincaId, range);
  return Number(costs?.[category]) || 0;
}

async function loadProductsForOc(action) {
  const items = Array.isArray(action?.params?.items) ? action.params.items : [];
  const ids = items.map(i => i?.productoId).filter(Boolean);
  return fetchManyByIds('productos', ids);
}

async function loadSolicitud(action) {
  const id = action?.executionResult?.solicitudId
    || action?.params?.solicitudId
    || null;
  if (!id) return null;
  const snap = await db.collection('solicitudes_compra').doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function loadAudit(actionId) {
  if (!actionId) return null;
  const snap = await db.collection('hr_recommendations_audit').doc(actionId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

// For orchestrator runs: rebuild a fresh FincaState + detect signals.
// We pass `now` through so tests can freeze time; production just uses
// `new Date()`. The build is moderately expensive (it touches 10+
// collections) but the sweep only calls it once per run-per-window.
async function loadCurrentSignals(fincaId, now) {
  const state = await buildFincaState(fincaId, { now });
  return detectSignals(state, { now });
}

// ── Public entry point ──────────────────────────────────────────────────────

// Returns an object whose keys correspond to the template's `requiredContext`.
// Each key is filled with whatever the loader produced, or `null` if nothing
// was found. The template's `evaluate()` is responsible for gracefully
// handling nulls (usually by returning `outcome: 'undetermined'`).
async function loadContext({ template, source, fincaId, now }) {
  const keys = Array.isArray(template?.requiredContext) ? template.requiredContext : [];
  const ctx = {};
  const evaluatedAt = now instanceof Date ? now : new Date();
  const period = currentMonthPeriod(evaluatedAt);

  for (const key of keys) {
    switch (key) {
      case 'sourceBudget':
        ctx.sourceBudget = await loadSourceBudget(source);
        break;
      case 'sourceExecution':
        ctx.sourceExecution = await loadSourceExecution(source, fincaId, period);
        break;
      case 'products':
        ctx.products = await loadProductsForOc(source);
        break;
      case 'solicitud':
        ctx.solicitud = await loadSolicitud(source);
        break;
      case 'audit':
        ctx.audit = await loadAudit(source?.id);
        break;
      case 'currentSignals':
        ctx.currentSignals = await loadCurrentSignals(fincaId, evaluatedAt);
        break;
      default:
        ctx[key] = null;
        break;
    }
  }

  return ctx;
}

module.exports = {
  loadContext,
  // Exported for tests / reuse
  _loaders: {
    loadSourceBudget,
    loadSourceExecution,
    loadProductsForOc,
    loadSolicitud,
    loadAudit,
    loadCurrentSignals,
    fetchManyByIds,
    currentMonthPeriod,
  },
};
