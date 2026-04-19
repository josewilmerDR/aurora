// KPI templates — Fase 6.2. Pure.
//
// A "template" defines how to evaluate a specific (sourceType, actionType,
// window) combination. Each template declares:
//
//   - sourceType: 'autopilot_action' | 'orchestrator_run'
//   - actionType: the autopilot_actions.type OR 'orchestrator_run'
//   - window:     30 | 90 | 365 days after the event
//   - metric:     stable identifier for the KPI (used in aggregation)
//   - requiredContext: keys the context loader must populate at evaluation time
//   - evaluate(source, ctx): pure function that produces an observation
//
// Outcomes:
//
//   'match'        — KPI verified in the expected direction
//   'miss'         — KPI verified in the opposite direction
//   'partial'      — mixed result (e.g., orchestrator with some signals
//                    resolved and some not). Counts as 0.5 in hit-rate.
//   'undetermined' — context is insufficient to evaluate (e.g., the
//                    target doc was deleted). Not counted in hit-rate.
//   'pending'      — waiting on a human ground-truth signal (HR audit).
//                    Also not counted in hit-rate.
//
// The aggregator (`kpiAccuracyAggregator`) uses these buckets to compute
// a per-metric hit rate plus exhaustive breakdowns.

// HR action types that route their evaluation through `hr_recommendations_audit`
// rather than doing a live metric measurement. The audit doc already captures
// humanResolution + outcomeMatchedReality; we just lift those into the unified
// meta_kpi_observations collection so the KPI aggregator can treat HR on equal
// footing with the other domains.
const HR_AUDIT_ACTION_TYPES = Object.freeze([
  'sugerir_contratacion',
  'sugerir_despido',
  'sugerir_sancion',
  'sugerir_memorando',
  'sugerir_revision_desempeno',
]);

const VALID_OUTCOMES = Object.freeze(['match', 'miss', 'partial', 'undetermined', 'pending']);
const VALID_WINDOWS = Object.freeze([30, 90, 365]);

// ── Template: reasignar_presupuesto @ 30d ────────────────────────────────────
//
// At T0 the agent moved `amount` from source→target budget. At T+30 we check
// whether the source category is still over-budget. If the reallocation
// relieved pressure and the source is no longer exceeding its assignment,
// the decision is judged a match.
//
// Required context:
//   sourceBudget      — the source budget doc (post-reallocation)
//   sourceExecution   — current executed total for source category
//
// If either is null we return `undetermined`.

const tpl_reasignar_presupuesto_30 = Object.freeze({
  sourceType: 'autopilot_action',
  actionType: 'reasignar_presupuesto',
  window: 30,
  metric: 'source_category_not_over_budget',
  description: 'Tras reasignación, la categoría de origen ya no está sobre-ejecutada.',
  requiredContext: ['sourceBudget', 'sourceExecution'],
  evaluate(action, ctx) {
    const source = ctx.sourceBudget;
    const executed = Number(ctx.sourceExecution);
    if (!source || !Number.isFinite(executed)) {
      return {
        metric: this.metric,
        value: null,
        expected: 'not_over_budget',
        outcome: 'undetermined',
        detail: 'Source budget or execution total unavailable at T+30.',
      };
    }
    const assigned = Number(source.assignedAmount) || 0;
    if (assigned <= 0) {
      return {
        metric: this.metric,
        value: { assigned, executed },
        expected: 'not_over_budget',
        outcome: 'undetermined',
        detail: 'Source budget has no assigned amount to compare against.',
      };
    }
    const pct = Math.round((executed / assigned) * 10000) / 100;
    const overBudget = executed > assigned;
    return {
      metric: this.metric,
      value: { assigned, executed, percentConsumed: pct, overBudget },
      expected: 'not_over_budget',
      outcome: overBudget ? 'miss' : 'match',
      detail: overBudget
        ? `Fuente sigue sobre-ejecutada: ${pct}% del asignado.`
        : `Fuente dentro del presupuesto: ${pct}% del asignado.`,
    };
  },
});

// ── Template: crear_orden_compra @ 30d ──────────────────────────────────────
//
// At T0 the agent emitted an OC for one or more productos. The intent was
// to prevent stock-outs. At T+30 we check whether each referenced producto
// is still at or above `stockMinimo`. If any producto fell below → miss;
// if all held → match.
//
// Required context:
//   products[]  — current producto docs for every productoId in the OC.
//                 Missing products are silently ignored.

const tpl_crear_orden_compra_30 = Object.freeze({
  sourceType: 'autopilot_action',
  actionType: 'crear_orden_compra',
  window: 30,
  metric: 'stock_held_above_min',
  description: 'Tras la OC, los productos referenciados no cayeron bajo stockMinimo.',
  requiredContext: ['products'],
  evaluate(action, ctx) {
    const items = Array.isArray(action?.params?.items) ? action.params.items : [];
    const productIds = items.map(i => i?.productoId).filter(Boolean);
    if (productIds.length === 0) {
      return {
        metric: this.metric,
        value: null,
        expected: 'stock >= min',
        outcome: 'undetermined',
        detail: 'OC has no items with productoId.',
      };
    }
    const products = Array.isArray(ctx.products) ? ctx.products : [];
    const byId = new Map(products.map(p => [p.id, p]));
    const observations = [];
    let matched = 0;
    let checked = 0;
    for (const pid of productIds) {
      const p = byId.get(pid);
      if (!p) continue; // product deleted — skip without penalty
      checked += 1;
      const actual = Number(p.stockActual) || 0;
      const min = Number(p.stockMinimo) || 0;
      const ok = actual >= min;
      if (ok) matched += 1;
      observations.push({ productoId: pid, stockActual: actual, stockMinimo: min, ok });
    }
    if (checked === 0) {
      return {
        metric: this.metric,
        value: { observations },
        expected: 'stock >= min',
        outcome: 'undetermined',
        detail: 'None of the productos referenced by the OC could be found at T+30.',
      };
    }
    const ratio = matched / checked;
    let outcome;
    if (ratio === 1) outcome = 'match';
    else if (ratio === 0) outcome = 'miss';
    else outcome = 'partial';
    return {
      metric: this.metric,
      value: { observations, matched, checked, ratio: Math.round(ratio * 1000) / 1000 },
      expected: 'stock >= min',
      outcome,
      detail: `${matched}/${checked} productos por encima de su stockMinimo.`,
    };
  },
});

// ── Template: crear_solicitud_compra @ 30d ──────────────────────────────────
//
// A successful SC leads to an OC (or is cancelled). At T+30 we check the
// solicitud's final state:
//   - completada / convertida / aprobada → match (we converted it to action)
//   - cancelada / rechazada → miss (the agent's suggestion was ignored)
//   - pendiente → miss (the team has had 30 days; still pending is a miss)
//
// Required context:
//   solicitud — the solicitudes_compra doc (may be null if deleted)

const SC_MATCH_STATES = new Set(['completada', 'convertida', 'aprobada', 'procesada']);
const SC_MISS_STATES = new Set(['cancelada', 'rechazada', 'pendiente']);

const tpl_crear_solicitud_compra_30 = Object.freeze({
  sourceType: 'autopilot_action',
  actionType: 'crear_solicitud_compra',
  window: 30,
  metric: 'solicitud_resolved_positively',
  description: 'La solicitud de compra se convirtió en OC dentro de 30 días.',
  requiredContext: ['solicitud'],
  evaluate(action, ctx) {
    const sol = ctx.solicitud;
    if (!sol) {
      return {
        metric: this.metric,
        value: null,
        expected: 'completada|convertida|aprobada',
        outcome: 'undetermined',
        detail: 'La solicitud ya no existe al momento de la evaluación.',
      };
    }
    const state = typeof sol.estado === 'string' ? sol.estado.toLowerCase() : '';
    if (SC_MATCH_STATES.has(state)) {
      return {
        metric: this.metric,
        value: { estado: sol.estado },
        expected: 'completada|convertida|aprobada',
        outcome: 'match',
        detail: `Solicitud cerrada en estado "${sol.estado}".`,
      };
    }
    if (SC_MISS_STATES.has(state)) {
      return {
        metric: this.metric,
        value: { estado: sol.estado },
        expected: 'completada|convertida|aprobada',
        outcome: 'miss',
        detail: `Solicitud quedó en estado "${sol.estado}" a los 30 días.`,
      };
    }
    return {
      metric: this.metric,
      value: { estado: sol.estado || null },
      expected: 'completada|convertida|aprobada',
      outcome: 'undetermined',
      detail: `Estado de solicitud desconocido: "${sol.estado || ''}".`,
    };
  },
});

// ── Template: orchestrator_run @ 30d ────────────────────────────────────────
//
// At T0 the orchestrator flagged certain domains (finalSteps[]) with an
// urgency tier. At T+30 we rebuild signals from the current FincaState and
// compare: if the majority of the originally-flagged domains have lower
// urgency ranks now, the plan "worked".
//
// Required context:
//   currentSignals — output of detectSignals(fincaState) at T+30

const tpl_orchestrator_run_30 = Object.freeze({
  sourceType: 'orchestrator_run',
  actionType: 'orchestrator_run',
  window: 30,
  metric: 'flagged_urgencies_resolved',
  description: 'Las urgencias señaladas por el plan bajaron al cabo de 30 días.',
  requiredContext: ['currentSignals'],
  evaluate(run, ctx) {
    const steps = Array.isArray(run?.finalSteps) ? run.finalSteps : [];
    if (steps.length === 0) {
      return {
        metric: this.metric,
        value: null,
        expected: 'urgency_drop_majority',
        outcome: 'undetermined',
        detail: 'El run no tenía pasos que evaluar.',
      };
    }
    const originalSignals = run?.signals || {};
    const current = ctx.currentSignals || {};
    const { URGENCY_RANK } = require('../orchestrator/signalDetector');

    const perDomain = [];
    let dropped = 0;
    let same = 0;
    let rose = 0;
    for (const step of steps) {
      const d = step.domain;
      const originalRank = URGENCY_RANK[originalSignals[d]?.urgency] ?? URGENCY_RANK.none;
      const currentRank = URGENCY_RANK[current[d]?.urgency] ?? URGENCY_RANK.none;
      const delta = originalRank - currentRank; // positive = dropped
      if (delta > 0) dropped += 1;
      else if (delta === 0) same += 1;
      else rose += 1;
      perDomain.push({
        domain: d,
        originalUrgency: originalSignals[d]?.urgency ?? 'none',
        currentUrgency: current[d]?.urgency ?? 'none',
        delta,
      });
    }

    const total = perDomain.length;
    const droppedRatio = dropped / total;
    const roseCount = rose;

    let outcome;
    if (droppedRatio >= 0.5 && roseCount === 0) outcome = 'match';
    else if (droppedRatio > 0 && roseCount < total / 2) outcome = 'partial';
    else outcome = 'miss';

    return {
      metric: this.metric,
      value: { perDomain, dropped, same, rose, total },
      expected: 'urgency_drop_majority',
      outcome,
      detail: `${dropped}/${total} dominios mejoraron, ${same} sin cambio, ${rose} empeoraron.`,
    };
  },
});

// ── Template: HR audit import (all HR action types, any window) ─────────────
//
// HR actions never execute autonomously — they always produce a proposed
// `autopilot_actions` doc plus, when the human resolves it, a companion
// `hr_recommendations_audit` doc. This "template" simply lifts the audit
// outcome into the unified meta_kpi_observations collection so the KPI
// aggregator sees HR on the same footing as other domains.
//
// Required context:
//   audit — the hr_recommendations_audit doc (may be null)

function hrAuditTemplate(actionType, window) {
  return Object.freeze({
    sourceType: 'autopilot_action',
    actionType,
    window,
    metric: 'hr_outcome_matched_reality',
    description: `Audit humano de "${actionType}" refleja si la recomendación aplicó.`,
    requiredContext: ['audit'],
    evaluate(action, ctx) {
      const audit = ctx.audit;
      if (!audit) {
        return {
          metric: this.metric,
          value: null,
          expected: 'outcomeMatchedReality === true',
          outcome: 'pending',
          detail: 'Aún no hay audit registrado para esta recomendación.',
        };
      }
      const r = audit.outcomeMatchedReality;
      if (r === true) {
        return {
          metric: this.metric,
          value: { humanResolution: audit.humanResolution ?? null, outcomeMatchedReality: true },
          expected: 'outcomeMatchedReality === true',
          outcome: 'match',
          detail: 'Audit humano confirma la recomendación.',
        };
      }
      if (r === false) {
        return {
          metric: this.metric,
          value: { humanResolution: audit.humanResolution ?? null, outcomeMatchedReality: false },
          expected: 'outcomeMatchedReality === true',
          outcome: 'miss',
          detail: 'Audit humano rechaza la recomendación.',
        };
      }
      return {
        metric: this.metric,
        value: { humanResolution: audit.humanResolution ?? null, outcomeMatchedReality: null },
        expected: 'outcomeMatchedReality === true',
        outcome: 'pending',
        detail: 'El audit existe pero outcomeMatchedReality aún no ha sido registrado.',
      };
    },
  });
}

// ── Registry ────────────────────────────────────────────────────────────────

const ALL_TEMPLATES = Object.freeze([
  tpl_reasignar_presupuesto_30,
  tpl_crear_orden_compra_30,
  tpl_crear_solicitud_compra_30,
  tpl_orchestrator_run_30,
  // HR action types are evaluated at 30d; the same template will also service
  // 90d/365d if we need longer horizons. Register each type×window explicitly
  // to keep the registry exhaustive.
  ...HR_AUDIT_ACTION_TYPES.map(t => hrAuditTemplate(t, 30)),
]);

// Lookup: `${sourceType}|${actionType}|${window}` → template
const TEMPLATE_INDEX = (() => {
  const map = new Map();
  for (const t of ALL_TEMPLATES) {
    map.set(`${t.sourceType}|${t.actionType}|${t.window}`, t);
  }
  return map;
})();

function findTemplate({ sourceType, actionType, window }) {
  return TEMPLATE_INDEX.get(`${sourceType}|${actionType}|${window}`) || null;
}

function windowsFor(sourceType, actionType) {
  const out = [];
  for (const t of ALL_TEMPLATES) {
    if (t.sourceType === sourceType && t.actionType === actionType) out.push(t.window);
  }
  return out.sort((a, b) => a - b);
}

module.exports = {
  ALL_TEMPLATES,
  HR_AUDIT_ACTION_TYPES,
  VALID_OUTCOMES,
  VALID_WINDOWS,
  SC_MATCH_STATES,
  SC_MISS_STATES,
  findTemplate,
  windowsFor,
  // Exported for tests
  _templates: {
    tpl_reasignar_presupuesto_30,
    tpl_crear_orden_compra_30,
    tpl_crear_solicitud_compra_30,
    tpl_orchestrator_run_30,
    hrAuditTemplate,
  },
};
