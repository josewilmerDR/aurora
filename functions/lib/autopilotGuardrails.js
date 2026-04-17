/**
 * Autopilot guardrails — validation of both session-level and global limits.
 *
 * Session limits cap a single Autopilot run (e.g. "no more than 5 actions in
 * this analysis"). Global limits cap activity per finca across time (e.g.
 * "no more than $30k in OCs per month"). Session limits are trivial to check
 * in-memory; global limits require Firestore aggregation queries against
 * `autopilot_actions` / `ordenes_compra`.
 *
 * Why aggregations instead of materialized counter docs:
 *   - No double-write, no drift, no cleanup cron.
 *   - Firestore count()/sum() are single-RPC aggregations — cheap at our
 *     expected volume (tens of actions per day per finca).
 *   - Small race window for concurrent actions is acceptable: worst case,
 *     one extra action sneaks through a limit. Guardrails are not hard
 *     security, they are safety rails.
 *
 * Time zones: quiet hours and day/month boundaries use server-local time
 * (Cloud Functions run in UTC by default). Users configuring hours should
 * account for this. Future work: per-finca timezone setting.
 */

const { db, Timestamp } = require('./firebase');

// Default values for each guardrail. Merged with what the user has set on
// autopilot_config.guardrails. null / undefined means "not enforced".
const DEFAULTS = Object.freeze({
  maxActionsPerSession: 5,
  maxStockAdjustPercent: 30,
  maxActionsPerDay: 20,
  maxOrdenesCompraPerDay: 3,
  maxOrdenCompraMonto: 5000,
  maxOrdenesCompraMonthlyAmount: 30000,
  maxNotificationsPerUserPerDay: 3,
  weekendActions: true, // true = allowed; false = blocked on Sat/Sun
});

const ALL_ACTION_TYPES = Object.freeze([
  'crear_tarea', 'reprogramar_tarea', 'reasignar_tarea',
  'ajustar_inventario', 'enviar_notificacion',
  'crear_solicitud_compra', 'crear_orden_compra',
]);

// ── Time helpers ────────────────────────────────────────────────────────────

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

/**
 * Returns true if `now` falls inside [start, end] where both are "HH:MM"
 * strings. Handles windows that cross midnight (e.g. 20:00 → 06:00).
 */
function isWithinQuietHours(now, start, end) {
  if (!start || !end) return false;
  const parse = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };
  const s = parse(start);
  const e = parse(end);
  if (s == null || e == null) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return s <= e
    ? cur >= s && cur < e
    : cur >= s || cur < e; // crosses midnight
}

// ── Monetary helpers ────────────────────────────────────────────────────────

function computeOrderAmount(params) {
  if (!params || !Array.isArray(params.items)) return 0;
  return params.items.reduce((sum, i) => {
    const q = parseFloat(i.cantidad) || 0;
    const p = parseFloat(i.precioUnitario) || 0;
    return sum + q * p;
  }, 0);
}

// ── Aggregation queries (global limits) ─────────────────────────────────────

async function countExecutedActionsToday(fincaId, startMs) {
  const snap = await db.collection('autopilot_actions')
    .where('fincaId', '==', fincaId)
    .where('status', '==', 'executed')
    .where('createdAt', '>=', Timestamp.fromMillis(startMs))
    .count()
    .get();
  return snap.data().count;
}

async function countOrdenesCompraToday(fincaId, startMs) {
  const snap = await db.collection('ordenes_compra')
    .where('fincaId', '==', fincaId)
    .where('createdAt', '>=', Timestamp.fromMillis(startMs))
    .count()
    .get();
  return snap.data().count;
}

async function sumOrdenesCompraThisMonth(fincaId, startMs) {
  const snap = await db.collection('ordenes_compra')
    .where('fincaId', '==', fincaId)
    .where('createdAt', '>=', Timestamp.fromMillis(startMs))
    .get();
  return snap.docs.reduce((sum, doc) => {
    const items = Array.isArray(doc.data().items) ? doc.data().items : [];
    return sum + items.reduce((s, i) => {
      const q = parseFloat(i.cantidad) || 0;
      const p = parseFloat(i.precioUnitario) || 0;
      return s + q * p;
    }, 0);
  }, 0);
}

async function countNotificationsToUserToday(fincaId, userId, startMs) {
  // autopilot_actions doesn't expose userId at the top level — it's nested in
  // `params.userId`. Firestore can't range-query nested fields efficiently, so
  // we fetch today's notification actions and filter in memory. Expected
  // volume is small (a few per day per finca).
  const snap = await db.collection('autopilot_actions')
    .where('fincaId', '==', fincaId)
    .where('status', '==', 'executed')
    .where('type', '==', 'enviar_notificacion')
    .where('createdAt', '>=', Timestamp.fromMillis(startMs))
    .get();
  return snap.docs.filter(d => d.data().params?.userId === userId).length;
}

// ── Public validator ────────────────────────────────────────────────────────

/**
 * Validates an action against all guardrails. Async because global limits
 * require Firestore queries.
 *
 *   actionType: 'crear_tarea' | 'crear_orden_compra' | ...
 *   params:     the action parameters
 *   guardrails: user-configured overrides (from autopilot_config.guardrails)
 *   ctx:        { fincaId, sessionExecutedCount, now? }
 *
 * Returns { allowed: bool, violations: string[] }.
 */
async function validateGuardrails(actionType, params, guardrails = {}, ctx = {}) {
  const violations = [];
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const cfg = { ...DEFAULTS, ...guardrails };
  const sessionExecutedCount = ctx.sessionExecutedCount ?? 0;
  const fincaId = ctx.fincaId;

  // ── Session limit ────────────────────────────────────────────────────────
  if (sessionExecutedCount >= cfg.maxActionsPerSession) {
    violations.push(`Límite de ${cfg.maxActionsPerSession} acciones autónomas por sesión alcanzado.`);
  }

  // ── Action type allowlist ────────────────────────────────────────────────
  const allowedTypes = guardrails.allowedActionTypes ?? ALL_ACTION_TYPES;
  if (!allowedTypes.includes(actionType)) {
    violations.push(`Tipo de acción "${actionType}" no está habilitado para ejecución autónoma.`);
  }

  // ── Blocked lotes ────────────────────────────────────────────────────────
  const blockedLotes = guardrails.blockedLotes ?? [];
  const loteId = params?.loteId || null;
  if (loteId && blockedLotes.includes(loteId)) {
    violations.push('El lote está bloqueado para acciones autónomas.');
  }

  // ── Stock % change (inventory adjustments) ───────────────────────────────
  if (actionType === 'ajustar_inventario') {
    const currentStock = params?.stockActual ?? 0;
    const nextStock = params?.stockNuevo ?? 0;
    if (currentStock > 0) {
      const pctChange = Math.abs(nextStock - currentStock) / currentStock * 100;
      if (pctChange > cfg.maxStockAdjustPercent) {
        violations.push(`Cambio de stock de ${pctChange.toFixed(0)}% excede el límite de ${cfg.maxStockAdjustPercent}%.`);
      }
    }
  }

  // ── Weekend block ────────────────────────────────────────────────────────
  if (cfg.weekendActions === false && isWeekend(now)) {
    violations.push('Las acciones autónomas están bloqueadas en fin de semana.');
  }

  // ── Quiet hours ──────────────────────────────────────────────────────────
  if (cfg.quietHours && cfg.quietHours.start && cfg.quietHours.end) {
    const enforce = Array.isArray(cfg.quietHours.enforce) && cfg.quietHours.enforce.length > 0
      ? cfg.quietHours.enforce
      : ['enviar_notificacion'];
    if (enforce.includes(actionType) && isWithinQuietHours(now, cfg.quietHours.start, cfg.quietHours.end)) {
      violations.push(`"${actionType}" no se permite en horario silencioso (${cfg.quietHours.start}–${cfg.quietHours.end}).`);
    }
  }

  // ── Monetary: single OC amount ───────────────────────────────────────────
  if (actionType === 'crear_orden_compra' && cfg.maxOrdenCompraMonto != null) {
    const amount = computeOrderAmount(params);
    if (amount > cfg.maxOrdenCompraMonto) {
      violations.push(`Monto de la OC ($${amount.toFixed(0)}) excede el límite de $${cfg.maxOrdenCompraMonto} por orden.`);
    }
  }

  // ── Global (cross-session) checks — require a finca context ──────────────
  if (fincaId) {
    const dayStart = startOfDay(now).getTime();

    // Daily action cap — broad check, applies to every action type
    if (cfg.maxActionsPerDay != null) {
      const executedToday = await countExecutedActionsToday(fincaId, dayStart);
      if (executedToday >= cfg.maxActionsPerDay) {
        violations.push(`Límite diario de ${cfg.maxActionsPerDay} acciones ejecutadas alcanzado.`);
      }
    }

    // OC-specific limits
    if (actionType === 'crear_orden_compra') {
      if (cfg.maxOrdenesCompraPerDay != null) {
        const ocsToday = await countOrdenesCompraToday(fincaId, dayStart);
        if (ocsToday >= cfg.maxOrdenesCompraPerDay) {
          violations.push(`Límite diario de ${cfg.maxOrdenesCompraPerDay} órdenes de compra alcanzado.`);
        }
      }
      if (cfg.maxOrdenesCompraMonthlyAmount != null) {
        const monthStart = startOfMonth(now).getTime();
        const sumSoFar = await sumOrdenesCompraThisMonth(fincaId, monthStart);
        const thisAmount = computeOrderAmount(params);
        if (sumSoFar + thisAmount > cfg.maxOrdenesCompraMonthlyAmount) {
          violations.push(`Esta OC ($${thisAmount.toFixed(0)}) + ya gastado este mes ($${sumSoFar.toFixed(0)}) excede el límite mensual de $${cfg.maxOrdenesCompraMonthlyAmount}.`);
        }
      }
    }

    // Per-user notification cap
    if (actionType === 'enviar_notificacion' && cfg.maxNotificationsPerUserPerDay != null && params?.userId) {
      const sentToday = await countNotificationsToUserToday(fincaId, params.userId, dayStart);
      if (sentToday >= cfg.maxNotificationsPerUserPerDay) {
        violations.push(`Ya se enviaron ${sentToday} notificaciones a este usuario hoy (límite: ${cfg.maxNotificationsPerUserPerDay}).`);
      }
    }
  }

  return { allowed: violations.length === 0, violations };
}

module.exports = {
  validateGuardrails,
  DEFAULTS,
  ALL_ACTION_TYPES,
  // Exposed for tests
  computeOrderAmount,
  isWithinQuietHours,
  isWeekend,
};
