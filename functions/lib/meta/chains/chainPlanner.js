// Chain planner — Fase 6.4. Claude opt-in with deterministic fallback.
//
// Given a finca state + an objective, emits a chain plan (array of
// cross-domain steps with optional DAG edges) that the executor can
// run. Claude is invoked with extended thinking enabled; the reasoning
// gets persisted on the chain doc alongside the plan.
//
// Deterministic fallbacks cover a handful of well-known objectives and
// are always available — if Claude fails (no key, HTTP error, malformed
// tool output), the caller can still ship a chain.

const { getAnthropicClient } = require('../../clients');
const {
  thinkingConfig,
  MAX_TOKENS_WITH_THINKING,
  buildReasoning,
} = require('../../autopilotReasoning');
const {
  ALLOWED_CHAIN_ACTIONS,
  MAX_CHAIN_STEPS,
  isActionChainable,
} = require('./chainValidator');

const MODEL = 'claude-sonnet-4-6';

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el planificador de cadenas estratégicas de Aurora — un CEO agrícola emergente que orquesta acciones cross-domain.

Recibes:
1. Un snapshot del estado de la finca (finanzas, procurement, RRHH, estrategia, financiamiento).
2. Un objetivo en lenguaje natural (ej. "cubrir déficit de agroquímicos sin exceder presupuesto").
3. El catálogo de acciones encadenables permitidas.

Tu tarea es proponer de 1 a ${MAX_CHAIN_STEPS} pasos que, ejecutados en secuencia (respetando \`dependsOn\`), alcancen el objetivo dentro de los límites de autonomía existentes.

Reglas duras (su violación hará que la cadena sea rechazada):
- SOLO usa actionTypes del catálogo permitido. Acciones de RRHH (sugerir_*) y financiamiento están prohibidas por política arquitectónica de Aurora.
- NO incluyas \`enviar_notificacion\`: no es reversible y una cadena debe poder revertirse atómicamente.
- Cada step tiene un \`id\` único (p. ej. "s1", "s2", ...). \`dependsOn\` es un array de ids previos; sin ciclos.
- Máximo ${MAX_CHAIN_STEPS} pasos.
- Cada step debe tener un \`rationale\` breve (1 oración) explicando por qué es necesario.
- Si el objetivo no es alcanzable con las acciones permitidas, devuelve 0 pasos con overallRationale explicando por qué.

Sé conservador. Si dudas, prefiere 2 pasos bien justificados sobre 5 especulativos.

Invoca siempre la herramienta \`emit_chain_plan\`. No respondas en texto plano.`;

// ── Tool schema ─────────────────────────────────────────────────────────────

const PLAN_TOOL = Object.freeze({
  name: 'emit_chain_plan',
  description: 'Emite la cadena de pasos cross-domain que ejecuta el objetivo.',
  input_schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        maxItems: MAX_CHAIN_STEPS,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Identificador corto y único del step (ej. "s1").' },
            domain: {
              type: 'string',
              enum: ['finance', 'procurement', 'strategy', 'meta'],
              description: 'Dominio operativo al que pertenece el step. RRHH y financiamiento no aparecen porque no son encadenables.',
            },
            actionType: {
              type: 'string',
              enum: ALLOWED_CHAIN_ACTIONS,
              description: 'Tipo de acción autopilot a ejecutar. Debe ser encadenable (compensable y no-HR / no-financing).',
            },
            params: {
              type: 'object',
              description: 'Parámetros de la acción. Su shape depende del actionType y es validada downstream por el dispatcher.',
            },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs de steps que deben ejecutarse antes que éste. Vacío para pasos iniciales.',
            },
            rationale: { type: 'string', description: 'Por qué este step (1 oración).' },
          },
          required: ['id', 'domain', 'actionType', 'params', 'rationale'],
        },
      },
      overallRationale: {
        type: 'string',
        description: 'Justificación del plan completo (1–3 oraciones).',
      },
    },
    required: ['steps', 'overallRationale'],
  },
});

// ── Prompt helpers (pure) ───────────────────────────────────────────────────

function summarizeFincaState(fincaState) {
  if (!fincaState) return 'Estado de la finca: sin datos.';
  const parts = [`As-of: ${fincaState.asOf || 'n/a'}, período ${fincaState.period || 'n/a'}.`];
  const f = fincaState.finance;
  if (f) {
    parts.push(
      'Finanzas:',
      `  - Ejecución global: ${f.budgetExecution?.summary?.overallPercent ?? 'n/a'}% (sobre-ejecución: ${f.budgetExecution?.summary?.overBudgetCount ?? 0} categorías).`,
      `  - Caja mínima proyectada: ${f.cashProjection?.minBalance ?? 'n/a'} (${f.cashProjection?.negativeWeeks ?? 0} semanas negativas).`,
    );
  }
  const p = fincaState.procurement;
  if (p) {
    const by = p.gapsByUrgency || {};
    parts.push(
      'Procurement:',
      `  - Gaps totales: ${p.gapCount ?? 0} (critical ${by.critical ?? 0}, high ${by.high ?? 0}).`,
    );
  }
  const h = fincaState.hr;
  if (h) {
    parts.push(
      'RRHH (consulta únicamente; acciones HR no son encadenables):',
      `  - Pico de carga: ${h.workloadProjection?.peakWeek?.estimatedPersonHours ?? 0}h vs capacidad ${h.capacity?.baselineWeeklyHours ?? 0}h.`,
    );
  }
  const s = fincaState.strategy;
  if (s) {
    parts.push(
      'Estrategia:',
      s.activeAnnualPlan ? `  - Plan anual activo v${s.activeAnnualPlan.version}.` : '  - Sin plan anual activo.',
    );
  }
  return parts.join('\n');
}

function buildUserContext({ fincaState, objective, hints }) {
  return [
    `Objetivo: ${objective}`,
    hints ? `Pistas del operador: ${hints}` : null,
    '',
    summarizeFincaState(fincaState),
    '',
    `Catálogo de acciones encadenables: ${ALLOWED_CHAIN_ACTIONS.join(', ')}.`,
    '',
    'Invoca emit_chain_plan con tu propuesta.',
  ].filter(Boolean).join('\n');
}

// ── Parse Claude response (pure) ───────────────────────────────────────────

function parseClaudeResponse(response) {
  if (!response || !Array.isArray(response.content)) return null;
  const toolBlock = response.content.find(b => b?.type === 'tool_use' && b?.name === PLAN_TOOL.name);
  if (!toolBlock || !toolBlock.input || typeof toolBlock.input !== 'object') return null;
  const input = toolBlock.input;
  if (typeof input.overallRationale !== 'string' || !input.overallRationale.trim()) return null;
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  const steps = [];
  for (const s of rawSteps) {
    if (!s || typeof s !== 'object') continue;
    if (typeof s.id !== 'string' || !s.id.trim()) continue;
    if (typeof s.actionType !== 'string' || !isActionChainable(s.actionType)) continue;
    if (typeof s.rationale !== 'string' || !s.rationale.trim()) continue;
    steps.push({
      id: s.id.trim(),
      domain: typeof s.domain === 'string' ? s.domain : 'unknown',
      actionType: s.actionType,
      params: s.params && typeof s.params === 'object' && !Array.isArray(s.params) ? s.params : {},
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.filter(d => typeof d === 'string' && d.trim()) : [],
      rationale: s.rationale.trim(),
    });
  }
  return {
    parsed: {
      steps,
      overallRationale: input.overallRationale.trim(),
    },
    toolBlock,
  };
}

// ── Deterministic fallback templates ───────────────────────────────────────
//
// When Claude is unavailable or the objective is a well-known operational
// pattern, we fall back to a small catalog of hand-authored chains. These
// must individually pass the validator — the caller still runs
// `validateChain(plan)` after this returns.

function fallbackChain(objective, fincaState) {
  const obj = String(objective || '').toLowerCase().trim();

  // Template 1: liberar caja moviendo presupuesto entre categorías.
  // Requiere 2 presupuestos pre-existentes en el snapshot: un "donador"
  // sobre-ejecutado no-agrícola y un "receptor" ajustable. No rellenamos
  // IDs mágicos — el operador debe completarlos antes de ejecutar.
  if (obj.includes('liberar caja') || obj.includes('liberar cash') || obj === 'liberar_caja') {
    return {
      steps: [
        {
          id: 's1',
          domain: 'finance',
          actionType: 'reasignar_presupuesto',
          params: {
            sourceBudgetId: '__TBD__',
            targetBudgetId: '__TBD__',
            amount: 0,
            reason: 'Liberación de caja (fallback determinista).',
          },
          dependsOn: [],
          rationale: 'Reasignar presupuesto de categoría holgada hacia categoría con urgencia operativa.',
        },
      ],
      overallRationale: 'Plan determinista mínimo. Completa sourceBudgetId, targetBudgetId y amount antes de ejecutar.',
    };
  }

  // Template 2: cubrir déficit de stock crítico con una OC directa.
  if (obj.includes('cubrir') && (obj.includes('deficit') || obj.includes('déficit') || obj.includes('stock'))) {
    const gaps = fincaState?.procurement?.stockGaps || [];
    const topGap = gaps.find(g => g.urgency === 'critical') || gaps[0];
    if (!topGap) {
      return {
        steps: [],
        overallRationale: 'No hay déficits de stock detectados en el snapshot actual.',
      };
    }
    return {
      steps: [
        {
          id: 's1',
          domain: 'procurement',
          actionType: 'crear_solicitud_compra',
          params: {
            items: [{
              productoId: topGap.productoId,
              nombreComercial: topGap.nombreComercial || '',
              cantidadSolicitada: topGap.suggestedQty || 0,
              unidad: '',
              stockActual: topGap.stockActual || 0,
              stockMinimo: topGap.stockMinimo || 0,
            }],
            notas: 'Solicitud autogenerada por plan determinista (cadena).',
          },
          dependsOn: [],
          rationale: `Cubrir el déficit crítico de ${topGap.nombreComercial || topGap.productoId} con una solicitud de compra.`,
        },
      ],
      overallRationale: `Plan determinista: emitir solicitud de compra para el producto con urgencia "${topGap.urgency}".`,
    };
  }

  // No fallback for this objective.
  return null;
}

// ── Glue (impure) ──────────────────────────────────────────────────────────

async function planChain({ fincaState, objective, hints, useClaude = false }) {
  // Try Claude first if explicitly requested.
  if (useClaude) {
    try {
      const userContext = buildUserContext({ fincaState, objective, hints });
      const client = getAnthropicClient();
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS_WITH_THINKING,
        thinking: thinkingConfig(),
        system: SYSTEM_PROMPT,
        tools: [PLAN_TOOL],
        messages: [{ role: 'user', content: userContext }],
      });
      const parsed = parseClaudeResponse(response);
      if (parsed) {
        return {
          plan: parsed.parsed,
          reasoning: buildReasoning(response, parsed.toolBlock),
          usedClaude: true,
          source: 'claude',
        };
      }
      // malformed tool output → fall through to deterministic
    } catch (err) {
      console.error('[CHAIN-PLANNER] Claude planning failed, falling back:', err?.message);
    }
  }

  const fb = fallbackChain(objective, fincaState);
  if (fb) {
    return { plan: fb, reasoning: null, usedClaude: false, source: 'fallback' };
  }

  return {
    plan: {
      steps: [],
      overallRationale: `No hay plantilla determinista para el objetivo "${objective}" y Claude no está disponible o no fue solicitado.`,
    },
    reasoning: null,
    usedClaude: false,
    source: 'empty',
  };
}

module.exports = {
  planChain,
  // Exposed for tests
  SYSTEM_PROMPT,
  PLAN_TOOL,
  parseClaudeResponse,
  buildUserContext,
  summarizeFincaState,
  fallbackChain,
};
