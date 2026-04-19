// Reúne el contexto estratégico completo para que Claude proponga
// actualizaciones del plan anual. Best-effort: cada fuente faltante se
// reporta como warning, no aborta.
//
// Fuentes integradas:
//   - Fase 4.1: yield agregado por paquete (último año) + temporadas
//   - Fase 4.2: rotation_recommendations más recientes por lote
//   - Fase 4.3: últimas 10 observaciones y alertas recientes
//   - Fase 4.4: último scenario (resumen + claudeAnalysis)
//   - Fase 1: budgets y treasury snapshot

const { db, Timestamp } = require('../firebase');
const { computeYieldAggregate } = require('./yieldAggregator');

function oneYearAgoIso(now = new Date()) {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
function todayIso(now = new Date()) { return new Date(now).toISOString().slice(0, 10); }

async function loadYieldSummary(fincaId, now = new Date()) {
  try {
    const out = await computeYieldAggregate(fincaId, {
      desde: oneYearAgoIso(now), hasta: todayIso(now), groupBy: 'paquete',
    });
    return { rows: out?.rows || [], resumen: out?.resumen || {}, warning: null };
  } catch (err) {
    return { rows: [], resumen: {}, warning: `yield_failed:${err.message || 'unknown'}` };
  }
}

async function loadLatestRotations(fincaId) {
  try {
    const snap = await db.collection('rotation_recommendations')
      .where('fincaId', '==', fincaId)
      .get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Más reciente por lote.
    const byLote = new Map();
    docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    for (const d of docs) {
      if (!byLote.has(d.loteId)) byLote.set(d.loteId, d);
    }
    return { items: Array.from(byLote.values()), warning: null };
  } catch (err) {
    return { items: [], warning: `rotations_failed:${err.message || 'unknown'}` };
  }
}

async function loadLatestScenario(fincaId) {
  try {
    const snap = await db.collection('scenarios').where('fincaId', '==', fincaId).get();
    if (snap.empty) return { scenario: null, warning: 'scenarios_none' };
    const docs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    return { scenario: docs[0], warning: null };
  } catch (err) {
    return { scenario: null, warning: `scenarios_failed:${err.message || 'unknown'}` };
  }
}

async function loadRecentSignals(fincaId, limit = 10) {
  try {
    const snap = await db.collection('external_signals').where('fincaId', '==', fincaId).get();
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.observedAt || '').localeCompare(a.observedAt || ''))
      .slice(0, limit);
    return { items, warning: null };
  } catch (err) {
    return { items: [], warning: `signals_failed:${err.message || 'unknown'}` };
  }
}

async function loadRecentSignalAlerts(fincaId) {
  try {
    const since = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const snap = await db.collection('feed')
      .where('fincaId', '==', fincaId)
      .where('timestamp', '>=', since)
      .get();
    const alerts = snap.docs
      .map(d => d.data())
      .filter(d => typeof d.eventType === 'string' && d.eventType.startsWith('signal_alert_'))
      .map(d => ({
        eventType: d.eventType, title: d.title, timestamp: d.timestamp,
      }));
    return { alerts, warning: null };
  } catch (err) {
    return { alerts: [], warning: `alerts_failed:${err.message || 'unknown'}` };
  }
}

async function loadBudgetsSnapshot(fincaId) {
  try {
    const snap = await db.collection('budgets').where('fincaId', '==', fincaId).get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { items, warning: null };
  } catch (err) {
    return { items: [], warning: `budgets_failed:${err.message || 'unknown'}` };
  }
}

async function loadActivePlan(fincaId, year) {
  try {
    const snap = await db.collection('annual_plans')
      .where('fincaId', '==', fincaId)
      .where('year', '==', year)
      .get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const active = docs.find(d => d.isActive === true);
    return { active, versions: docs, warning: null };
  } catch (err) {
    return { active: null, versions: [], warning: `plan_failed:${err.message || 'unknown'}` };
  }
}

// Cuenta versiones creadas en los últimos 7 días (cap semanal).
async function countVersionsLast7Days(fincaId, year, now = new Date()) {
  try {
    const since = Timestamp.fromMillis(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const snap = await db.collection('annual_plans')
      .where('fincaId', '==', fincaId)
      .where('year', '==', year)
      .where('createdAt', '>=', since)
      .get();
    return snap.size;
  } catch (err) {
    return 0;
  }
}

async function loadPlanContext(fincaId, year, { now = new Date() } = {}) {
  const warnings = [];
  const [yield_, rotations, scenario, signals, alerts, budgets, plan] = await Promise.all([
    loadYieldSummary(fincaId, now),
    loadLatestRotations(fincaId),
    loadLatestScenario(fincaId),
    loadRecentSignals(fincaId),
    loadRecentSignalAlerts(fincaId),
    loadBudgetsSnapshot(fincaId),
    loadActivePlan(fincaId, year),
  ]);
  [yield_.warning, rotations.warning, scenario.warning, signals.warning,
    alerts.warning, budgets.warning, plan.warning].forEach(w => { if (w) warnings.push(w); });
  const weeklyCount = await countVersionsLast7Days(fincaId, year, now);

  return {
    year,
    today: todayIso(now),
    yield: { rows: yield_.rows, resumen: yield_.resumen },
    rotations: rotations.items,
    latestScenario: scenario.scenario,
    recentSignals: signals.items,
    recentAlerts: alerts.alerts,
    budgets: budgets.items,
    activePlan: plan.active || null,
    allVersions: plan.versions,
    weeklyCount,
    warnings,
  };
}

module.exports = {
  loadPlanContext,
  countVersionsLast7Days,
};
