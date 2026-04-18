// Unit tests for the RFQ Claude prompt builder. Pure.

const {
  SYSTEM_PROMPT,
  WINNER_TOOL,
  buildUserContext,
} = require('../../lib/procurement/rfqClaudePrompt');

const rfq = {
  productoId: 'P1',
  nombreComercial: 'Urea 46%',
  cantidad: 100,
  unidad: 'kg',
  currency: 'USD',
  deadline: '2026-05-01',
  maxLeadTimeDays: 14,
};

const resp = (overrides) => ({
  response: {
    supplierId: 'S1',
    supplierName: 'Agro SA',
    precioUnitario: 80,
    leadTimeDays: 5,
    moneda: 'USD',
  },
  signals: { orderCount: 12, avgLeadTimeDays: 6.3, fillRate: 0.98 },
  score: 85,
  ...overrides,
});

describe('buildUserContext', () => {
  test('includes product, qty, currency, deadline, and deterministic pick', () => {
    const out = buildUserContext({
      rfq,
      deterministicWinner: {
        supplierId: 'S1', supplierName: 'Agro SA', precioUnitario: 80, leadTimeDays: 5, moneda: 'USD',
      },
      eligibleWithSignals: [resp()],
    });
    expect(out).toMatch(/Urea 46%/);
    expect(out).toMatch(/100 kg/);
    expect(out).toMatch(/USD/);
    expect(out).toMatch(/2026-05-01/);
    expect(out).toMatch(/14 días/);
    expect(out).toMatch(/Agro SA \(S1\)/);
    expect(out).toMatch(/80 USD/);
  });

  test('renders supplier history when signals are present', () => {
    const out = buildUserContext({
      rfq,
      deterministicWinner: null,
      eligibleWithSignals: [resp()],
    });
    expect(out).toMatch(/12 OCs hist\./);
    expect(out).toMatch(/lead hist\. 6\.3d/);
    expect(out).toMatch(/fill 98%/);
    expect(out).toMatch(/score 85/);
  });

  test('notes lack of history when signals are missing', () => {
    const out = buildUserContext({
      rfq,
      deterministicWinner: null,
      eligibleWithSignals: [resp({ signals: {}, score: null })],
    });
    expect(out).toMatch(/sin historial/i);
  });

  test('falls back to producto id when name is absent', () => {
    const out = buildUserContext({
      rfq: { ...rfq, nombreComercial: '' },
      deterministicWinner: null,
      eligibleWithSignals: [],
    });
    expect(out).toMatch(/P1/);
  });

  test('reports "sin tope" when maxLeadTimeDays is null', () => {
    const out = buildUserContext({
      rfq: { ...rfq, maxLeadTimeDays: null },
      deterministicWinner: null,
      eligibleWithSignals: [],
    });
    expect(out).toMatch(/sin tope/);
  });

  test('WINNER_TOOL schema requires supplierId and razon', () => {
    expect(WINNER_TOOL.input_schema.required).toEqual(['supplierId', 'razon']);
    expect(WINNER_TOOL.name).toBe('select_rfq_winner');
    expect(Object.isFrozen(WINNER_TOOL)).toBe(true);
  });

  test('SYSTEM_PROMPT mentions the tool name so Claude knows what to call', () => {
    expect(SYSTEM_PROMPT).toMatch(/select_rfq_winner/);
  });
});
