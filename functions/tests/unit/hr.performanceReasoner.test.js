// Unit tests for performanceReasoner. Pattern 2.5 — opt-in Claude
// reasoning with silent deterministic fallback.

const {
  reasonAboutAlert,
  deterministicTemplate,
  buildUserContext,
  extractDraftFromResponse,
} = require('../../lib/hr/performanceReasoner');

function sampleAlert(severity = 'media') {
  return {
    userId: 'u1',
    severity,
    reason: severity === 'alta' ? 'Decil inferior 3 meses' : 'p25 2 meses',
    evidenceRefs: {
      periods: severity === 'alta' ? ['2026-04', '2026-03', '2026-02'] : ['2026-04', '2026-03'],
      scores:  severity === 'alta' ? [5, 8, 10] : [40, 42],
      cutoffsUsed: [
        { period: '2026-04', p25: 65, p10: 20, reliableCount: 4 },
        { period: '2026-03', p25: 66, p10: 22, reliableCount: 4 },
      ],
    },
  };
}

describe('deterministicTemplate', () => {
  test('mentions the severity and evidence periods', () => {
    const text = deterministicTemplate(sampleAlert('media'));
    expect(text).toMatch(/p25/);
    expect(text).toMatch(/2026-04/);
    expect(text).toMatch(/2026-03/);
  });

  test('never mentions salary, money, firing, or sanction', () => {
    const text = deterministicTemplate(sampleAlert('alta'));
    expect(text).not.toMatch(/\$|USD|salario|sueldo|despido|sanci[oó]n|memorando/i);
  });

  test('recommends a conversation, not an action', () => {
    const text = deterministicTemplate(sampleAlert('media'));
    expect(text).toMatch(/conversar|conversación/i);
  });
});

describe('buildUserContext', () => {
  test('includes all evidence periods and cutoffs', () => {
    const ctx = buildUserContext(sampleAlert('alta'));
    expect(ctx).toMatch(/2026-04/);
    expect(ctx).toMatch(/2026-03/);
    expect(ctx).toMatch(/2026-02/);
    expect(ctx).toMatch(/p25=65/);
  });

  test('includes subscores snapshot when provided', () => {
    const ctx = buildUserContext(sampleAlert(), {
      subscoresSnapshot: { completionRate: 40, punctuality: 50 },
    });
    expect(ctx).toMatch(/completionRate/);
  });

  test('never includes worker names — forces [trabajador] placeholder', () => {
    const alert = sampleAlert('media');
    const ctx = buildUserContext(alert);
    expect(ctx).not.toMatch(/u1/); // userId must not leak into prompt
  });
});

describe('extractDraftFromResponse', () => {
  test('returns null on missing content', () => {
    expect(extractDraftFromResponse(null)).toBeNull();
    expect(extractDraftFromResponse({})).toBeNull();
    expect(extractDraftFromResponse({ content: [] })).toBeNull();
  });

  test('returns null when tool_use is absent', () => {
    const response = { content: [{ type: 'text', text: 'hola' }] };
    expect(extractDraftFromResponse(response)).toBeNull();
  });

  test('extracts note when tool_use present', () => {
    const response = {
      content: [
        { type: 'thinking', thinking: 'razonando...' },
        { type: 'tool_use', name: 'draft_review_note', input: { note: 'Se observa tendencia' } },
      ],
    };
    const parsed = extractDraftFromResponse(response);
    expect(parsed.note).toBe('Se observa tendencia');
  });

  test('ignores tool_use with wrong name', () => {
    const response = {
      content: [{ type: 'tool_use', name: 'other_tool', input: { note: 'x' } }],
    };
    expect(extractDraftFromResponse(response)).toBeNull();
  });
});

describe('reasonAboutAlert — pattern 2.5 fallback', () => {
  test('enabled=false → deterministic fallback, no Claude call', async () => {
    const anthropic = { messages: { create: jest.fn() } };
    const out = await reasonAboutAlert(sampleAlert(), {}, { enabled: false, anthropicClient: anthropic });
    expect(out.fallback).toBe(true);
    expect(out.text).toMatch(/p25/);
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  test('anthropic client missing → deterministic fallback', async () => {
    const out = await reasonAboutAlert(sampleAlert(), {}, { enabled: true, anthropicClient: null });
    expect(out.fallback).toBe(true);
  });

  test('Claude error → deterministic fallback, does not throw', async () => {
    const anthropic = { messages: { create: jest.fn().mockRejectedValue(new Error('boom')) } };
    const out = await reasonAboutAlert(sampleAlert(), {}, { enabled: true, anthropicClient: anthropic });
    expect(out.fallback).toBe(true);
    expect(out.text).toMatch(/p25/);
  });

  test('Claude returns no tool_use → deterministic fallback', async () => {
    const anthropic = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'nada estructurado' }],
    }) } };
    const out = await reasonAboutAlert(sampleAlert(), {}, { enabled: true, anthropicClient: anthropic });
    expect(out.fallback).toBe(true);
  });

  test('Claude success → returns note and captures reasoning', async () => {
    const response = {
      content: [
        { type: 'thinking', thinking: 'pensando...' },
        { type: 'tool_use', name: 'draft_review_note', input: { note: 'Se observa una tendencia' } },
      ],
      model: 'claude-sonnet-4-6',
    };
    const anthropic = { messages: { create: jest.fn().mockResolvedValue(response) } };
    const out = await reasonAboutAlert(sampleAlert(), {}, { enabled: true, anthropicClient: anthropic });
    expect(out.fallback).toBe(false);
    expect(out.text).toBe('Se observa una tendencia');
    expect(out.reasoning.thinking).toMatch(/pensando/);
    expect(out.reasoning.toolName).toBe('draft_review_note');
    expect(out.reasoning.modelVersion).toBe('claude-sonnet-4-6');
  });

  test('system prompt enforces no names and no salaries (verification by call shape)', async () => {
    const anthropic = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'tool_use', name: 'draft_review_note', input: { note: 'x' } }],
    }) } };
    await reasonAboutAlert(sampleAlert(), {}, { enabled: true, anthropicClient: anthropic });
    const call = anthropic.messages.create.mock.calls[0][0];
    expect(call.system).toMatch(/nunca una sanción/i);
    expect(call.system).toMatch(/salario/i); // appears in prohibited list
    expect(call.system).toMatch(/\[trabajador\]/);
  });
});
