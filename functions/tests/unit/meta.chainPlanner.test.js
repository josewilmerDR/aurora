// Unit tests for chainPlanner — Fase 6.4.
// Only the pure helpers (parseClaudeResponse, fallbackChain, buildUserContext)
// are covered here. The Claude glue requires a live client and is exercised
// by integration tests.

const {
  PLAN_TOOL,
  SYSTEM_PROMPT,
  parseClaudeResponse,
  buildUserContext,
  summarizeFincaState,
  fallbackChain,
} = require('../../lib/meta/chains/chainPlanner');

const { MAX_CHAIN_STEPS } = require('../../lib/meta/chains/chainValidator');

function toolResponse(input) {
  return {
    content: [
      { type: 'thinking', thinking: '...' },
      { type: 'tool_use', name: PLAN_TOOL.name, input },
    ],
    model: 'claude-sonnet-4-6',
  };
}

describe('tool schema invariants', () => {
  test('tool is frozen and well-formed', () => {
    expect(Object.isFrozen(PLAN_TOOL)).toBe(true);
    expect(PLAN_TOOL.name).toBe('emit_chain_plan');
    expect(PLAN_TOOL.input_schema.required).toEqual(['steps', 'overallRationale']);
  });

  test('tool caps steps at MAX_CHAIN_STEPS', () => {
    expect(PLAN_TOOL.input_schema.properties.steps.maxItems).toBe(MAX_CHAIN_STEPS);
  });

  test('tool domain enum explicitly excludes hr and financing', () => {
    const enumVals = PLAN_TOOL.input_schema.properties.steps.items.properties.domain.enum;
    expect(enumVals).not.toContain('hr');
    expect(enumVals).not.toContain('rrhh');
    expect(enumVals).not.toContain('financing');
  });

  test('system prompt mentions the ban on HR/financing actions', () => {
    expect(SYSTEM_PROMPT).toMatch(/sugerir_\*/i);
    expect(SYSTEM_PROMPT).toMatch(/RRHH/i);
    expect(SYSTEM_PROMPT).toMatch(/financiamiento/i);
    expect(SYSTEM_PROMPT).toMatch(/enviar_notificacion/i);
  });
});

describe('parseClaudeResponse', () => {
  test('parses a valid plan', () => {
    const out = parseClaudeResponse(toolResponse({
      steps: [
        { id: 's1', domain: 'finance', actionType: 'reasignar_presupuesto', params: { amount: 500 }, rationale: 'liberar caja' },
        { id: 's2', domain: 'procurement', actionType: 'crear_solicitud_compra', params: {}, dependsOn: ['s1'], rationale: 'reponer stock' },
      ],
      overallRationale: 'Liberar caja y reponer stock.',
    }));
    expect(out).not.toBeNull();
    expect(out.parsed.steps).toHaveLength(2);
    expect(out.parsed.steps[1].dependsOn).toEqual(['s1']);
  });

  test('filters out steps with HR actionType', () => {
    const out = parseClaudeResponse(toolResponse({
      steps: [
        { id: 's1', domain: 'hr', actionType: 'sugerir_contratacion', params: {}, rationale: 'x' },
        { id: 's2', domain: 'finance', actionType: 'reasignar_presupuesto', params: {}, rationale: 'y' },
      ],
      overallRationale: 'plan',
    }));
    expect(out.parsed.steps).toHaveLength(1);
    expect(out.parsed.steps[0].id).toBe('s2');
  });

  test('filters out steps with financing actionType', () => {
    const out = parseClaudeResponse(toolResponse({
      steps: [
        { id: 's1', domain: 'financing', actionType: 'tomar_prestamo', params: {}, rationale: 'x' },
        { id: 's2', domain: 'finance', actionType: 'reasignar_presupuesto', params: {}, rationale: 'y' },
      ],
      overallRationale: 'plan',
    }));
    expect(out.parsed.steps).toHaveLength(1);
  });

  test('filters out steps with enviar_notificacion', () => {
    const out = parseClaudeResponse(toolResponse({
      steps: [
        { id: 's1', domain: 'meta', actionType: 'enviar_notificacion', params: {}, rationale: 'x' },
      ],
      overallRationale: 'plan',
    }));
    expect(out.parsed.steps).toHaveLength(0);
  });

  test('returns null when overallRationale missing', () => {
    expect(parseClaudeResponse(toolResponse({ steps: [] }))).toBeNull();
  });

  test('returns null when overallRationale is blank', () => {
    expect(parseClaudeResponse(toolResponse({ steps: [], overallRationale: '   ' }))).toBeNull();
  });

  test('drops malformed step objects', () => {
    const out = parseClaudeResponse(toolResponse({
      steps: [
        null,
        'bogus',
        { id: 's1' }, // missing actionType + rationale
        { id: 's2', actionType: 'crear_tarea', rationale: 'ok' },
      ],
      overallRationale: 'plan',
    }));
    expect(out.parsed.steps).toHaveLength(1);
    expect(out.parsed.steps[0].id).toBe('s2');
  });

  test('returns null when response has no tool_use block', () => {
    expect(parseClaudeResponse({ content: [{ type: 'text', text: 'hi' }] })).toBeNull();
    expect(parseClaudeResponse(null)).toBeNull();
    expect(parseClaudeResponse({})).toBeNull();
  });
});

describe('fallbackChain', () => {
  test('liberar_caja template produces a single reasignar_presupuesto step', () => {
    const out = fallbackChain('liberar caja', {});
    expect(out).not.toBeNull();
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0].actionType).toBe('reasignar_presupuesto');
  });

  test('cubrir_deficit template uses the top critical gap from the snapshot', () => {
    const out = fallbackChain('cubrir déficit de stock', {
      procurement: {
        stockGaps: [
          { productoId: 'p1', urgency: 'critical', nombreComercial: 'Fungicida X', suggestedQty: 50, stockActual: 10, stockMinimo: 20 },
          { productoId: 'p2', urgency: 'high', nombreComercial: 'Y', suggestedQty: 5 },
        ],
      },
    });
    expect(out).not.toBeNull();
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0].actionType).toBe('crear_solicitud_compra');
    expect(out.steps[0].params.items[0].productoId).toBe('p1');
  });

  test('cubrir_deficit returns empty plan when no gaps', () => {
    const out = fallbackChain('cubrir déficit de stock', { procurement: { stockGaps: [] } });
    expect(out.steps).toEqual([]);
  });

  test('unknown objective returns null', () => {
    expect(fallbackChain('ganar la lotería', {})).toBeNull();
  });
});

describe('prompt builders', () => {
  test('summarizeFincaState produces a readable block', () => {
    const out = summarizeFincaState({
      asOf: '2026-04-18',
      period: '2026-04',
      finance: { budgetExecution: { summary: { overallPercent: 85, overBudgetCount: 1 } }, cashProjection: { minBalance: 200, negativeWeeks: 0 } },
      procurement: { gapCount: 2, gapsByUrgency: { critical: 1, high: 1 } },
      hr: { workloadProjection: { peakWeek: { estimatedPersonHours: 80 } }, capacity: { baselineWeeklyHours: 60 } },
      strategy: { activeAnnualPlan: { version: 3 } },
    });
    expect(out).toMatch(/Finanzas/);
    expect(out).toMatch(/Procurement/);
    expect(out).toMatch(/RRHH/);
    expect(out).toMatch(/Estrategia/);
  });

  test('buildUserContext includes objective and catalog', () => {
    const ctx = buildUserContext({ fincaState: {}, objective: 'test objective' });
    expect(ctx).toMatch(/Objetivo: test objective/);
    expect(ctx).toMatch(/Catálogo de acciones encadenables/);
    expect(ctx).toMatch(/emit_chain_plan/);
  });
});
