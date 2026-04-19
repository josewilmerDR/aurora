// Chain validator — Fase 6.4. Pure.
//
// Validates a proposed chain plan against Aurora's cross-domain-execution
// constraints before anything touches Firestore:
//
//   - Max `MAX_CHAIN_STEPS` steps. Wider chains are rejected: at scale,
//     a failed 9+ step chain would amplify rollback risk past our
//     confidence interval.
//   - Allowed action types only. HR actions (FORBIDDEN_AT_NIVEL3 per
//     Fase 3.0) and financing actions (N1-only per Fase 5.5) are never
//     chainable. `enviar_notificacion` is excluded because it is NOT
//     compensable — a rollback cascade cannot un-send a WhatsApp.
//   - DAG invariants. Every `dependsOn` id must reference a prior step
//     by id; no cycles, no self-references, no duplicates.
//   - Well-formed step shape: id + actionType + params (object).
//
// Returns `{ ok: true, orderedStepIds }` when valid, or `{ ok: false,
// reasons: [...] }` when not.

const { HR_ACTION_TYPES } = require('./_actionTypeLists');

const MAX_CHAIN_STEPS = 8;
const MAX_DEPENDS_ON_PER_STEP = 8;

// Action types that a chain may include. Every entry here must have a
// compensation descriptor in `autopilotCompensations.buildDescriptor`
// other than `'not_compensable'`. Keep in sync when adding new actions.
const ALLOWED_CHAIN_ACTIONS = Object.freeze([
  'crear_tarea',
  'reprogramar_tarea',
  'reasignar_tarea',
  'ajustar_inventario',
  'crear_solicitud_compra',
  'crear_orden_compra',
  'reasignar_presupuesto',
  'crear_siembra',
  'ajustar_guardrails',
]);

// Action types explicitly forbidden inside chains. Documented as strings
// for invariant tests — the ban is enforced by the allow-list above, not
// by this list. Having both makes the intent unmissable in code review.
const FORBIDDEN_CHAIN_ACTIONS = Object.freeze([
  // HR — not executable autonomously (Fase 3.0 cap, 4 layers of defense)
  ...HR_ACTION_TYPES,
  // Financing — N1-only by architecture (Fase 5.5 policy)
  'aplicar_credito',
  'solicitar_credito',
  'tomar_prestamo',
  'contratar_deuda',
  'aceptar_oferta_credito',
  'firmar_pagare',
  // Not compensable — cannot be rolled back
  'enviar_notificacion',
]);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

// Kahn's algorithm topological sort. Returns `{ ok, order }` or `{ ok: false, reason }`.
// Deterministic within one call (uses insertion order of the input ids to break ties).
function topologicalSort(steps) {
  const indegree = new Map();
  const graph = new Map();
  const idOrder = [];
  for (const s of steps) {
    indegree.set(s.id, 0);
    graph.set(s.id, []);
    idOrder.push(s.id);
  }
  for (const s of steps) {
    for (const dep of s.dependsOn || []) {
      if (!indegree.has(dep)) {
        return { ok: false, reason: `Step "${s.id}" depends on unknown id "${dep}".` };
      }
      graph.get(dep).push(s.id);
      indegree.set(s.id, indegree.get(s.id) + 1);
    }
  }
  const queue = idOrder.filter(id => indegree.get(id) === 0);
  const order = [];
  while (queue.length > 0) {
    const next = queue.shift();
    order.push(next);
    for (const child of graph.get(next)) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  if (order.length !== steps.length) {
    return { ok: false, reason: 'Chain contains a dependency cycle.' };
  }
  return { ok: true, order };
}

function validateChain(plan) {
  const reasons = [];
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];

  if (steps.length === 0) {
    return { ok: false, reasons: ['Chain must contain at least one step.'] };
  }
  if (steps.length > MAX_CHAIN_STEPS) {
    reasons.push(`Chain exceeds maximum of ${MAX_CHAIN_STEPS} steps (${steps.length} given).`);
  }

  // Per-step shape + content.
  const seenIds = new Set();
  for (const [idx, step] of steps.entries()) {
    const label = isNonEmptyString(step?.id) ? step.id : `index ${idx}`;
    if (!isNonEmptyString(step?.id)) {
      reasons.push(`Step at ${label}: missing or empty id.`);
      continue; // downstream checks need the id
    }
    if (seenIds.has(step.id)) {
      reasons.push(`Duplicate step id "${step.id}".`);
    }
    seenIds.add(step.id);
    if (!isNonEmptyString(step.actionType)) {
      reasons.push(`Step "${step.id}": actionType is required.`);
      continue;
    }
    if (FORBIDDEN_CHAIN_ACTIONS.includes(step.actionType)) {
      reasons.push(`Step "${step.id}": action "${step.actionType}" is forbidden in chains.`);
    } else if (!ALLOWED_CHAIN_ACTIONS.includes(step.actionType)) {
      reasons.push(`Step "${step.id}": action "${step.actionType}" is not a known chainable action.`);
    }
    if (step.params != null && !isPlainObject(step.params)) {
      reasons.push(`Step "${step.id}": params must be an object.`);
    }
    if (step.dependsOn != null) {
      if (!Array.isArray(step.dependsOn)) {
        reasons.push(`Step "${step.id}": dependsOn must be an array.`);
      } else {
        if (step.dependsOn.length > MAX_DEPENDS_ON_PER_STEP) {
          reasons.push(`Step "${step.id}": dependsOn exceeds ${MAX_DEPENDS_ON_PER_STEP} entries.`);
        }
        for (const dep of step.dependsOn) {
          if (!isNonEmptyString(dep)) {
            reasons.push(`Step "${step.id}": dependsOn contains a non-string id.`);
          } else if (dep === step.id) {
            reasons.push(`Step "${step.id}": cannot depend on itself.`);
          }
        }
      }
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  // DAG check (requires all steps to have shape fixed).
  const topo = topologicalSort(steps);
  if (!topo.ok) {
    return { ok: false, reasons: [topo.reason] };
  }

  return { ok: true, orderedStepIds: topo.order };
}

// Lightweight per-step check used by callers that want to filter the
// chain's action list against the policy (e.g., the planner's Claude
// output validator).
function isActionChainable(actionType) {
  if (!isNonEmptyString(actionType)) return false;
  if (FORBIDDEN_CHAIN_ACTIONS.includes(actionType)) return false;
  return ALLOWED_CHAIN_ACTIONS.includes(actionType);
}

module.exports = {
  validateChain,
  topologicalSort,
  isActionChainable,
  ALLOWED_CHAIN_ACTIONS,
  FORBIDDEN_CHAIN_ACTIONS,
  MAX_CHAIN_STEPS,
  MAX_DEPENDS_ON_PER_STEP,
};
