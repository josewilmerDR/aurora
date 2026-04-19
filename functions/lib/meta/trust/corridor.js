// Trust corridor — Fase 6.3. Pure config + invariants.
//
// The "corridor" is the bounded range within which the trust manager may
// adjust each guardrail based on a finca's track record. Each guardrail
// has a floor (most restrictive), a default (neutral starting point), and
// a ceiling (most permissive). Trust near 1.0 can push values toward
// ceiling; trust near 0.0 pushes toward floor. No value ever escapes
// [floor, ceiling] — those bounds are absolute.
//
// CRITICAL: the corridor must NOT include any guardrail that controls an
// architectural cap. Financing N1-only (Fase 5.5), HR forbidden-at-nivel3
// (Fase 3.0), kill switches, and domain levels are NEVER subject to
// dynamic adjustment. The invariant test in
// tests/unit/meta.corridorInvariant.test.js scans this config and fails
// if a forbidden key creeps in.

const FLOOR_CEILING_UNIT_DEFAULTS = Object.freeze({
  usd: 'USD',
  count: 'count',
  percent: 'percent',
});

// Each entry documents:
//   - floor / default / ceiling: value bounds (all inclusive)
//   - direction: semantic hint for UIs. 'relax_is_higher' means numerically
//     larger values grant MORE autonomy (e.g. maxOrdenCompraMonto); 'relax_is_lower'
//     means numerically larger values grant LESS autonomy (none yet).
//   - domains: the autonomy domains whose trust drives this guardrail.
//     Trust input is the confidence-weighted average across these domains.
//   - unit: display hint for UIs
const CORRIDOR = Object.freeze({
  maxOrdenCompraMonto: Object.freeze({
    floor: 1000,
    default: 5000,
    ceiling: 15000,
    direction: 'relax_is_higher',
    domains: ['finance', 'procurement'],
    unit: FLOOR_CEILING_UNIT_DEFAULTS.usd,
  }),
  maxOrdenesCompraPerDay: Object.freeze({
    floor: 1,
    default: 3,
    ceiling: 8,
    direction: 'relax_is_higher',
    domains: ['finance', 'procurement'],
    unit: FLOOR_CEILING_UNIT_DEFAULTS.count,
  }),
  maxOrdenesCompraMonthlyAmount: Object.freeze({
    floor: 10000,
    default: 30000,
    ceiling: 60000,
    direction: 'relax_is_higher',
    domains: ['finance', 'procurement'],
    unit: FLOOR_CEILING_UNIT_DEFAULTS.usd,
  }),
  maxBudgetConsumptionPct: Object.freeze({
    floor: 85,
    default: 100,
    ceiling: 120,
    direction: 'relax_is_higher',
    domains: ['finance'],
    unit: FLOOR_CEILING_UNIT_DEFAULTS.percent,
  }),
  maxStockAdjustPercent: Object.freeze({
    floor: 10,
    default: 30,
    ceiling: 50,
    direction: 'relax_is_higher',
    domains: ['procurement'],
    unit: FLOOR_CEILING_UNIT_DEFAULTS.percent,
  }),
  maxActionsPerDay: Object.freeze({
    floor: 5,
    default: 20,
    ceiling: 40,
    direction: 'relax_is_higher',
    domains: ['finance', 'procurement', 'hr', 'strategy'],
    unit: FLOOR_CEILING_UNIT_DEFAULTS.count,
  }),
  maxActionsPerSession: Object.freeze({
    floor: 3,
    default: 5,
    ceiling: 15,
    direction: 'relax_is_higher',
    domains: ['finance', 'procurement', 'hr', 'strategy'],
    unit: FLOOR_CEILING_UNIT_DEFAULTS.count,
  }),
  maxNotificationsPerUserPerDay: Object.freeze({
    floor: 1,
    default: 3,
    ceiling: 8,
    direction: 'relax_is_higher',
    domains: ['finance', 'procurement', 'hr', 'strategy'],
    unit: FLOOR_CEILING_UNIT_DEFAULTS.count,
  }),
});

// Keys that MUST NOT appear in the corridor. The invariant test scans
// `Object.keys(CORRIDOR)` and fails if any of these match. This is the
// last line of defense against someone accidentally putting a structural
// cap under dynamic control.
const FORBIDDEN_CORRIDOR_KEYS = Object.freeze([
  // Kill switches — safety absolute, never automatable
  'activo',
  'kill_switch',
  // Domain levels — escalation requires human sign-off per Fase 3/5 policy
  'nivel',
  'level',
  'mode',
  // Financing — Nivel 1 only per Fase 5.5, no quantitative knob exists that
  // should be trust-adjusted. Listed as strings in case someone tries to
  // sneak one in.
  'maxCreditAmount',
  'maxCreditPlazo',
  'maxAprAllowed',
  'allowFinancingActions',
  // HR caps — forbidden-at-nivel3 list is code-enforced, not a knob
  'allowHrAutonomousActions',
  'maxHrEscalationLevel',
]);

const DOMAIN_KEYS = Object.freeze([
  'finance',
  'procurement',
  'hr',
  'strategy',
  // Intentionally absent: 'financing'. Trust on financing never feeds the
  // corridor because all financing decisions stay at N1 by architecture.
]);

// Validates a proposed value against a corridor entry. Returns either
// `{ ok: true, value }` with the clamped value or `{ ok: false, reason }`
// if the value is not numeric.
function clampToCorridor(key, value) {
  const entry = CORRIDOR[key];
  if (!entry) return { ok: false, reason: `Unknown corridor key: ${key}` };
  if (value == null || typeof value === 'boolean') {
    return { ok: false, reason: `Value for ${key} is not a finite number.` };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, reason: `Value for ${key} is not a finite number.` };
  const clamped = Math.max(entry.floor, Math.min(entry.ceiling, n));
  return { ok: true, value: clamped };
}

// Retrieves the current value for a guardrail from the config doc,
// falling back to the corridor's default when missing.
function readGuardrailValue(currentGuardrails, key) {
  const entry = CORRIDOR[key];
  if (!entry) return null;
  const raw = currentGuardrails?.[key];
  if (raw == null) return entry.default;
  const n = Number(raw);
  return Number.isFinite(n) ? n : entry.default;
}

// Exposed list of corridor keys — useful for iteration + tests.
const CORRIDOR_KEYS = Object.freeze(Object.keys(CORRIDOR));

module.exports = {
  CORRIDOR,
  CORRIDOR_KEYS,
  DOMAIN_KEYS,
  FORBIDDEN_CORRIDOR_KEYS,
  clampToCorridor,
  readGuardrailValue,
};
