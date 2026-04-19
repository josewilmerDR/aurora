// Claude-backed orchestrator planner — Fase 6.1. Opt-in.
//
// Given a FincaState and the deterministic plan (from `callPlanner.buildPlan`),
// Claude REVIEWS the plan and may:
//   - approve it as-is, or
//   - propose a reordering of the existing steps, or
//   - flag individual steps as skippable with a reason.
//
// Claude CANNOT add new steps. The deterministic planner is the source of
// truth for what's possible; Claude only refines priority and surfaces
// judgment (e.g., "cash floor is far enough above zero that the budget
// reassignment isn't urgent this week"). Extended thinking is enabled and
// the reasoning is persisted alongside the run.
//
// Safe by design: any failure path (no API key, HTTP error, malformed
// tool reply, invalid domain list) returns `null`. The route falls back
// to the deterministic plan untouched.

const { getAnthropicClient } = require('../../clients');
const {
  thinkingConfig,
  MAX_TOKENS_WITH_THINKING,
  buildReasoning,
} = require('../../autopilotReasoning');

const MODEL = 'claude-sonnet-4-6';

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el orquestador estratégico de Aurora, un CEO agrícola emergente.

Recibes:
1. Un snapshot del estado de la finca agregado en los 5 dominios (finanzas, procurement, RRHH, estrategia, financiamiento).
2. Un plan de llamadas propuesto de forma determinista por heurísticas sobre el snapshot.

Tu tarea es revisar el plan y, si es necesario, proponer ajustes. Puedes:
  - Aprobarlo como está.
  - Proponer un reordenamiento de los dominios del plan (mismo set, distinto orden).
  - Marcar dominios individuales como omisibles con una razón corta.

NO puedes agregar dominios nuevos al plan. Si el plan está vacío, apruébalo vacío.

Reglas duras:
- El orden debe ser una permutación (o subconjunto) de los dominios ya presentes.
- Si marcas un dominio como omisible, DEBES dar una razón concreta basada en el snapshot.
- Sé conservador al omitir algo: la heurística determinista lo incluyó por una razón.
- El razonamiento final (overallRationale) va en español, 1-3 oraciones.

Invoca siempre la herramienta \`review_orchestrator_plan\`. No respondas en texto plano.`;

// ── Tool schema ─────────────────────────────────────────────────────────────

const REVIEW_TOOL = Object.freeze({
  name: 'review_orchestrator_plan',
  description: 'Emite la revisión final del plan: aprobado, reordenado, o con dominios omitidos.',
  input_schema: {
    type: 'object',
    properties: {
      approved: {
        type: 'boolean',
        description: 'True si el plan determinista es adecuado tal cual (sin reordenar ni omitir).',
      },
      orderedDomains: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['finance', 'procurement', 'hr', 'strategy', 'financing'],
        },
        description: 'Orden final de dominios. Debe ser subconjunto/reordenamiento del plan original. Omite dominios que quieras saltar.',
      },
      skippedDomains: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            domain: {
              type: 'string',
              enum: ['finance', 'procurement', 'hr', 'strategy', 'financing'],
            },
            reason: { type: 'string' },
          },
          required: ['domain', 'reason'],
        },
        description: 'Dominios del plan original que quieres omitir, con razón.',
      },
      overallRationale: {
        type: 'string',
        description: 'Justificación breve del ajuste (1-3 oraciones, en español).',
      },
    },
    required: ['approved', 'overallRationale'],
  },
});

// ── Prompt formatters (pure) ────────────────────────────────────────────────

function formatFinance(finance) {
  if (!finance) return 'Finanzas: sin datos.';
  const exec = finance.budgetExecution?.summary || {};
  const cash = finance.cashProjection || {};
  return [
    'Finanzas:',
    `  - Ejecución global: ${exec.overallPercent ?? 'n/a'}% (categorías excedidas: ${exec.overBudgetCount ?? 0}).`,
    `  - Caja: saldo mínimo proyectado ${cash.minBalance ?? 'n/a'} (${cash.negativeWeeks ?? 0} semanas negativas).`,
  ].join('\n');
}

function formatProcurement(proc) {
  if (!proc) return 'Procurement: sin datos.';
  const by = proc.gapsByUrgency || {};
  return [
    'Procurement:',
    `  - Gaps totales: ${proc.gapCount ?? 0} (critical ${by.critical ?? 0}, high ${by.high ?? 0}, medium ${by.medium ?? 0}, low ${by.low ?? 0}).`,
  ].join('\n');
}

function formatHr(hr) {
  if (!hr) return 'RRHH: sin datos.';
  const wl = hr.workloadProjection || {};
  const cap = hr.capacity || {};
  const trend = hr.performanceTrend || {};
  return [
    'RRHH:',
    `  - Pico de carga: ${wl.peakWeek?.estimatedPersonHours ?? 0}h (semana ${wl.peakWeek?.weekStart ?? 'n/a'}).`,
    `  - Capacidad permanente: ${cap.baselineWeeklyHours ?? 0}h/sem (${cap.permanentCount ?? 0} trabajadores).`,
    `  - Trend desempeño: Δ ${trend.delta ?? 'n/a'} (${trend.sampleSizeCurrent ?? 0} actual / ${trend.sampleSizePrevious ?? 0} prev).`,
  ].join('\n');
}

function formatStrategy(strategy) {
  if (!strategy) return 'Estrategia: sin datos.';
  const plan = strategy.activeAnnualPlan;
  const sigs = Array.isArray(strategy.recentSignals) ? strategy.recentSignals : [];
  const lines = ['Estrategia:'];
  lines.push(plan
    ? `  - Plan anual activo v${plan.version} (${plan.year}).`
    : '  - Sin plan anual activo.');
  lines.push(`  - Señales externas recientes: ${sigs.length}`
    + (sigs.length > 0 ? ` (máx confianza ${Math.max(...sigs.map(s => Number(s.confidence) || 0)).toFixed(2)}).` : '.'));
  return lines.join('\n');
}

function formatFinancing(financing) {
  if (!financing) return 'Financiamiento: sin datos.';
  const last = financing.lastDebtSimulation;
  if (!last) return 'Financiamiento: sin simulaciones de deuda recientes.';
  return [
    'Financiamiento:',
    `  - Última simulación: ${last.creditProductName || '(sin nombre)'} — recomendación "${last.recommendation || 'n/a'}".`,
  ].join('\n');
}

function formatDeterministicPlan(plan) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (steps.length === 0) return 'Plan determinista: (vacío).';
  const lines = ['Plan determinista propuesto:'];
  steps.forEach((s, i) => {
    lines.push(`${i + 1}. [${s.urgency}] ${s.domain} — ${s.rationale || '(sin razón)'}`);
  });
  return lines.join('\n');
}

function buildUserContext({ fincaState, plan }) {
  return [
    `As-of: ${fincaState?.asOf || 'n/a'}, período ${fincaState?.period || 'n/a'}.`,
    '',
    formatFinance(fincaState?.finance),
    '',
    formatProcurement(fincaState?.procurement),
    '',
    formatHr(fincaState?.hr),
    '',
    formatStrategy(fincaState?.strategy),
    '',
    formatFinancing(fincaState?.financing),
    '',
    formatDeterministicPlan(plan),
    '',
    'Invoca review_orchestrator_plan con tu revisión.',
  ].join('\n');
}

// ── Parse / apply (pure) ────────────────────────────────────────────────────

function parseClaudeResponse(response) {
  if (!response || !Array.isArray(response.content)) return null;
  const toolBlock = response.content.find(b => b?.type === 'tool_use' && b?.name === REVIEW_TOOL.name);
  if (!toolBlock || !toolBlock.input || typeof toolBlock.input !== 'object') return null;
  const input = toolBlock.input;

  if (typeof input.approved !== 'boolean') return null;
  if (typeof input.overallRationale !== 'string' || !input.overallRationale.trim()) return null;

  const orderedDomains = Array.isArray(input.orderedDomains) ? input.orderedDomains : [];
  const skippedDomains = Array.isArray(input.skippedDomains) ? input.skippedDomains : [];

  return {
    parsed: {
      approved: input.approved,
      orderedDomains: orderedDomains.filter(d => typeof d === 'string'),
      skippedDomains: skippedDomains
        .filter(s => s && typeof s.domain === 'string' && typeof s.reason === 'string')
        .map(s => ({ domain: s.domain, reason: s.reason.trim() })),
      overallRationale: input.overallRationale.trim(),
    },
    toolBlock,
  };
}

// Applies Claude's review to the deterministic plan. Guarantees:
//   - the returned plan's steps are a subset/permutation of the original
//   - skipped domains never reappear
//   - invalid reorderings fall back to the deterministic order with any
//     explicitly skipped domains removed
function applyReview(plan, review) {
  const originalSteps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (!review) return { steps: originalSteps.slice(), adjustments: null };

  const originalByDomain = new Map(originalSteps.map(s => [s.domain, s]));
  const skippedSet = new Set((review.skippedDomains || []).map(s => s.domain));

  // Case 1: approved and no explicit ordering — keep original, drop skips.
  if (review.approved && (!Array.isArray(review.orderedDomains) || review.orderedDomains.length === 0)) {
    const steps = originalSteps.filter(s => !skippedSet.has(s.domain));
    return {
      steps,
      adjustments: {
        reordered: false,
        skipped: Array.from(skippedSet),
        overallRationale: review.overallRationale || null,
      },
    };
  }

  // Case 2: explicit ordering — must be a subset of original. Anything not
  // in the ordering is treated as an implicit skip UNLESS it was already in
  // the explicit skip list (for transparency).
  const orderedSteps = [];
  const seen = new Set();
  for (const d of review.orderedDomains || []) {
    if (!originalByDomain.has(d) || seen.has(d) || skippedSet.has(d)) continue;
    orderedSteps.push(originalByDomain.get(d));
    seen.add(d);
  }

  // If the reorder is invalid (empty despite a non-empty original and no
  // skips), fall back to the deterministic order.
  if (orderedSteps.length === 0 && originalSteps.length > 0 && skippedSet.size === 0) {
    return { steps: originalSteps.slice(), adjustments: null };
  }

  const implicitSkipped = originalSteps
    .map(s => s.domain)
    .filter(d => !seen.has(d) && !skippedSet.has(d));

  return {
    steps: orderedSteps,
    adjustments: {
      reordered: true,
      skipped: [...Array.from(skippedSet), ...implicitSkipped],
      overallRationale: review.overallRationale || null,
    },
  };
}

// ── Glue (impure) ───────────────────────────────────────────────────────────

async function refineWithClaude({ fincaState, plan }) {
  try {
    const userContext = buildUserContext({ fincaState, plan });
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS_WITH_THINKING,
      thinking: thinkingConfig(),
      system: SYSTEM_PROMPT,
      tools: [REVIEW_TOOL],
      messages: [{ role: 'user', content: userContext }],
    });
    const parsed = parseClaudeResponse(response);
    if (!parsed) return null;
    const applied = applyReview(plan, parsed.parsed);
    return {
      review: parsed.parsed,
      refinedSteps: applied.steps,
      adjustments: applied.adjustments,
      reasoning: buildReasoning(response, parsed.toolBlock),
    };
  } catch (err) {
    console.error('[META-ORCHESTRATOR-CLAUDE] refine failed:', err.message);
    return null;
  }
}

module.exports = {
  refineWithClaude,
  // Pure exports for tests.
  SYSTEM_PROMPT,
  REVIEW_TOOL,
  buildUserContext,
  parseClaudeResponse,
  applyReview,
  _internals: {
    formatFinance,
    formatProcurement,
    formatHr,
    formatStrategy,
    formatFinancing,
    formatDeterministicPlan,
  },
};
