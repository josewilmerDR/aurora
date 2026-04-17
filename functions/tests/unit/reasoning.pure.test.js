/**
 * Unit tests for lib/autopilotReasoning.js.
 */

const {
  thinkingConfig,
  extractThinking,
  buildReasoning,
  stripReasoning,
  THINKING_BUDGET_TOKENS,
  MAX_TOKENS_WITH_THINKING,
} = require('../../lib/autopilotReasoning');

describe('thinkingConfig', () => {
  test('returns an "enabled" config with a positive budget', () => {
    const cfg = thinkingConfig();
    expect(cfg.type).toBe('enabled');
    expect(cfg.budget_tokens).toBe(THINKING_BUDGET_TOKENS);
    expect(cfg.budget_tokens).toBeGreaterThan(0);
  });

  test('budget fits within MAX_TOKENS_WITH_THINKING', () => {
    expect(THINKING_BUDGET_TOKENS).toBeLessThan(MAX_TOKENS_WITH_THINKING);
  });
});

describe('extractThinking', () => {
  test('returns empty string for null/undefined/missing content', () => {
    expect(extractThinking(null)).toBe('');
    expect(extractThinking(undefined)).toBe('');
    expect(extractThinking({})).toBe('');
    expect(extractThinking({ content: null })).toBe('');
  });

  test('joins thinking blocks with blank lines', () => {
    const response = {
      content: [
        { type: 'thinking', thinking: 'First insight.' },
        { type: 'text', text: 'Visible text, ignored.' },
        { type: 'thinking', thinking: 'Second insight.' },
      ],
    };
    expect(extractThinking(response)).toBe('First insight.\n\nSecond insight.');
  });

  test('represents redacted_thinking with a marker', () => {
    const response = {
      content: [
        { type: 'redacted_thinking' },
        { type: 'thinking', thinking: 'After redaction.' },
      ],
    };
    const out = extractThinking(response);
    expect(out).toMatch(/redactado/);
    expect(out).toContain('After redaction.');
  });

  test('ignores non-thinking block types', () => {
    const response = {
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_use', name: 'x', input: {} },
      ],
    };
    expect(extractThinking(response)).toBe('');
  });
});

describe('buildReasoning', () => {
  test('captures thinking + tool use + model version', () => {
    const response = {
      model: 'claude-sonnet-4-6',
      content: [
        { type: 'thinking', thinking: 'I will create a task.' },
        { type: 'tool_use', name: 'proponer_crear_tarea', input: { nombre: 'X' } },
      ],
    };
    const block = response.content[1];
    const reasoning = buildReasoning(response, block);
    expect(reasoning.thinking).toBe('I will create a task.');
    expect(reasoning.toolName).toBe('proponer_crear_tarea');
    expect(reasoning.toolInput).toEqual({ nombre: 'X' });
    expect(reasoning.modelVersion).toBe('claude-sonnet-4-6');
    expect(typeof reasoning.capturedAt).toBe('string');
  });

  test('tolerates missing response/block', () => {
    const r = buildReasoning(null, null);
    expect(r.thinking).toBe('');
    expect(r.toolName).toBeNull();
    expect(r.toolInput).toBeNull();
    expect(r.modelVersion).toBeNull();
  });
});

describe('stripReasoning', () => {
  test('removes the reasoning field, keeps the rest', () => {
    const action = { id: '1', titulo: 'X', reasoning: { thinking: 'secret' } };
    const stripped = stripReasoning(action);
    expect(stripped).toEqual({ id: '1', titulo: 'X' });
    // Does not mutate original
    expect(action.reasoning).toBeDefined();
  });

  test('no-op on null/undefined/non-object', () => {
    expect(stripReasoning(null)).toBeNull();
    expect(stripReasoning(undefined)).toBeUndefined();
    expect(stripReasoning('str')).toBe('str');
  });
});
