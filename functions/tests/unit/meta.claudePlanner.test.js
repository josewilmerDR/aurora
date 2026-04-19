// Unit tests for claudePlanner pure helpers — Fase 6.1.
// Network-touching `refineWithClaude` is NOT covered here.

const {
  parseClaudeResponse,
  applyReview,
  buildUserContext,
  REVIEW_TOOL,
  SYSTEM_PROMPT,
} = require('../../lib/meta/orchestrator/claudePlanner');

function toolResponse(input) {
  return {
    content: [
      { type: 'thinking', thinking: 'reasoning here' },
      { type: 'tool_use', name: REVIEW_TOOL.name, input },
    ],
    model: 'claude-sonnet-4-6',
  };
}

describe('parseClaudeResponse', () => {
  test('parses a well-formed approval', () => {
    const out = parseClaudeResponse(toolResponse({
      approved: true,
      orderedDomains: ['finance', 'procurement'],
      skippedDomains: [],
      overallRationale: 'Plan razonable, mantener orden.',
    }));
    expect(out).not.toBeNull();
    expect(out.parsed.approved).toBe(true);
    expect(out.parsed.orderedDomains).toEqual(['finance', 'procurement']);
    expect(out.parsed.overallRationale).toBe('Plan razonable, mantener orden.');
  });

  test('returns null when approved is missing', () => {
    expect(parseClaudeResponse(toolResponse({ overallRationale: 'x' }))).toBeNull();
  });

  test('returns null when overallRationale is empty', () => {
    expect(parseClaudeResponse(toolResponse({ approved: true, overallRationale: '   ' }))).toBeNull();
  });

  test('filters malformed skippedDomains entries', () => {
    const out = parseClaudeResponse(toolResponse({
      approved: false,
      orderedDomains: ['procurement'],
      skippedDomains: [
        { domain: 'finance', reason: 'ok' },
        { domain: 'hr' },       // missing reason
        'bogus',                 // wrong type
        { reason: 'only' },      // missing domain
      ],
      overallRationale: 'reorden.',
    }));
    expect(out.parsed.skippedDomains).toEqual([{ domain: 'finance', reason: 'ok' }]);
  });

  test('returns null when tool block is absent', () => {
    const resp = { content: [{ type: 'text', text: 'hola' }] };
    expect(parseClaudeResponse(resp)).toBeNull();
  });

  test('returns null when response is malformed', () => {
    expect(parseClaudeResponse(null)).toBeNull();
    expect(parseClaudeResponse({})).toBeNull();
    expect(parseClaudeResponse({ content: [] })).toBeNull();
  });
});

describe('applyReview', () => {
  const plan = {
    steps: [
      { domain: 'finance', urgency: 'high' },
      { domain: 'procurement', urgency: 'high' },
      { domain: 'hr', urgency: 'medium' },
    ],
  };

  test('approval with no ordering keeps original order, drops explicit skips', () => {
    const out = applyReview(plan, {
      approved: true,
      orderedDomains: [],
      skippedDomains: [{ domain: 'hr', reason: 'carga ok' }],
      overallRationale: 'ok',
    });
    expect(out.steps.map(s => s.domain)).toEqual(['finance', 'procurement']);
    expect(out.adjustments.reordered).toBe(false);
    expect(out.adjustments.skipped).toEqual(['hr']);
  });

  test('explicit ordering uses the given order', () => {
    const out = applyReview(plan, {
      approved: false,
      orderedDomains: ['procurement', 'finance', 'hr'],
      skippedDomains: [],
      overallRationale: 'reorden.',
    });
    expect(out.steps.map(s => s.domain)).toEqual(['procurement', 'finance', 'hr']);
    expect(out.adjustments.reordered).toBe(true);
  });

  test('ordering may omit domains (implicit skip)', () => {
    const out = applyReview(plan, {
      approved: false,
      orderedDomains: ['procurement'],
      skippedDomains: [],
      overallRationale: 'solo procurement.',
    });
    expect(out.steps.map(s => s.domain)).toEqual(['procurement']);
    expect(out.adjustments.skipped).toEqual(expect.arrayContaining(['finance', 'hr']));
  });

  test('unknown domains in ordering are ignored', () => {
    const out = applyReview(plan, {
      approved: false,
      orderedDomains: ['procurement', 'bogus', 'finance'],
      skippedDomains: [],
      overallRationale: 'x',
    });
    expect(out.steps.map(s => s.domain)).toEqual(['procurement', 'finance']);
  });

  test('empty ordering with non-empty original and no skips falls back to deterministic', () => {
    const out = applyReview(plan, {
      approved: false,
      orderedDomains: [],
      skippedDomains: [],
      overallRationale: 'x',
    });
    expect(out.steps.map(s => s.domain)).toEqual(['finance', 'procurement', 'hr']);
    expect(out.adjustments).toBeNull();
  });

  test('no review → original plan untouched', () => {
    const out = applyReview(plan, null);
    expect(out.steps.map(s => s.domain)).toEqual(['finance', 'procurement', 'hr']);
    expect(out.adjustments).toBeNull();
  });

  test('duplicates in ordering are deduplicated', () => {
    const out = applyReview(plan, {
      approved: false,
      orderedDomains: ['finance', 'finance', 'procurement'],
      skippedDomains: [],
      overallRationale: 'x',
    });
    expect(out.steps.map(s => s.domain)).toEqual(['finance', 'procurement']);
  });

  test('skip list wins: domain in both ordering and skipped is NOT included', () => {
    const out = applyReview(plan, {
      approved: false,
      orderedDomains: ['finance', 'procurement'],
      skippedDomains: [{ domain: 'finance', reason: 'ya resuelto' }],
      overallRationale: 'x',
    });
    expect(out.steps.map(s => s.domain)).toEqual(['procurement']);
    expect(out.adjustments.skipped).toEqual(expect.arrayContaining(['finance', 'hr']));
  });
});

describe('buildUserContext', () => {
  test('produces a human-readable prompt with key sections', () => {
    const fincaState = {
      asOf: '2026-04-18',
      period: '2026-04',
      finance: {
        budgetExecution: { summary: { overallPercent: 85, overBudgetCount: 1 } },
        cashProjection: { minBalance: 1000, negativeWeeks: 0 },
      },
      procurement: { gapCount: 2, gapsByUrgency: { critical: 0, high: 1, medium: 1, low: 0 } },
      hr: {
        workloadProjection: { peakWeek: { estimatedPersonHours: 80, weekStart: '2026-05-04' } },
        capacity: { baselineWeeklyHours: 60, permanentCount: 2 },
        performanceTrend: { delta: -3, sampleSizeCurrent: 2, sampleSizePrevious: 2 },
      },
      strategy: { activeAnnualPlan: { version: 4, year: 2026 }, recentSignals: [{ confidence: 0.7 }] },
      financing: { lastDebtSimulation: { creditProductName: 'Banco X', recommendation: 'tomar_condicional' } },
    };
    const plan = { steps: [{ domain: 'procurement', urgency: 'high', rationale: 'déficit' }] };
    const prompt = buildUserContext({ fincaState, plan });
    expect(prompt).toContain('Finanzas:');
    expect(prompt).toContain('Procurement:');
    expect(prompt).toContain('RRHH:');
    expect(prompt).toContain('Estrategia:');
    expect(prompt).toContain('Financiamiento:');
    expect(prompt).toContain('Plan determinista');
    expect(prompt).toContain('[high] procurement');
  });

  test('handles missing FincaState sections gracefully', () => {
    const prompt = buildUserContext({ fincaState: {}, plan: { steps: [] } });
    expect(prompt).toContain('Finanzas: sin datos.');
    expect(prompt).toContain('Plan determinista: (vacío).');
  });
});

describe('tool schema', () => {
  test('REVIEW_TOOL is frozen and well-formed', () => {
    expect(Object.isFrozen(REVIEW_TOOL)).toBe(true);
    expect(REVIEW_TOOL.name).toBe('review_orchestrator_plan');
    expect(REVIEW_TOOL.input_schema.required).toEqual(['approved', 'overallRationale']);
  });

  test('SYSTEM_PROMPT mentions the key constraints', () => {
    expect(SYSTEM_PROMPT).toMatch(/review_orchestrator_plan/);
    expect(SYSTEM_PROMPT).toMatch(/reordenamiento/);
    expect(SYSTEM_PROMPT).toMatch(/NO puedes agregar dominios/);
  });
});
