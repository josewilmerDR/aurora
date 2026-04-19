// Unit tests for the eligibility reasoner. Pure bits only — no HTTP.

const {
  SYSTEM_PROMPT,
  RECOMMENDATION_TOOL,
  buildUserContext,
  parseClaudeResponse,
  _internals: { formatSummary, formatProduct, formatEvaluation },
} = require('../../lib/financing/eligibilityReasoner');

const SUMMARY = {
  totalEquity: 200000,
  totalAssets: 250000,
  cashAmount: 50000,
  annualRevenue: 120000,
  avgMonthlyInflow: 15000,
  avgMonthlyNet: 5000,
  minProjectedBalance: 15000,
};

const PRODUCT = {
  providerName: 'Banco X',
  providerType: 'banco',
  tipo: 'agricola',
  esquemaAmortizacion: 'cuota_fija',
  monedaMin: 5000, monedaMax: 100000,
  plazoMesesMin: 6, plazoMesesMax: 24,
  aprMin: 0.10, aprMax: 0.18, moneda: 'USD',
  requisitos: [{ tipo: 'documento', codigo: 'rut', descripcion: 'Cédula jurídica' }],
};

const EVALUATION = {
  productId: 'P1',
  score: 0.62,
  recommendation: 'revisar',
  suggestedTerm: { monthlyPayment: 2500, plazoMeses: 24, apr: 0.18 },
  softChecks: [
    { name: 'cash_floor', applicable: true, passed: false, score: 0.4, detail: 'Cuota/neto 40%' },
    { name: 'projected_liquidity', applicable: true, passed: true, score: 1, detail: 'OK' },
    { name: 'equity_coverage', applicable: false, score: 1, detail: 'N/A' },
    { name: 'revenue_scale', applicable: false, score: 1, detail: 'N/A' },
  ],
  manualChecks: [{ codigo: 'rut', descripcion: 'Cédula jurídica' }],
};

describe('tool schema', () => {
  test('has expected name and required fields', () => {
    expect(RECOMMENDATION_TOOL.name).toBe('emit_credit_recommendation');
    expect(RECOMMENDATION_TOOL.input_schema.required).toEqual(['recommendation', 'razon']);
  });

  test('recommendation enum covers all three verdicts', () => {
    const enumVals = RECOMMENDATION_TOOL.input_schema.properties.recommendation.enum;
    expect(enumVals.sort()).toEqual(['no_tomar', 'tomar', 'tomar_condicional']);
  });
});

describe('formatSummary', () => {
  test('emits one line per canonical metric', () => {
    const out = formatSummary(SUMMARY);
    expect(out).toMatch(/Patrimonio/);
    expect(out).toMatch(/Caja disponible/);
    expect(out).toMatch(/Revenue 12m/);
    expect(out).toMatch(/Flujo neto mensual/);
    expect(out).toMatch(/Saldo mínimo proyectado/);
  });
});

describe('formatProduct', () => {
  test('includes provider + range + APR formatted as percent', () => {
    const out = formatProduct(PRODUCT);
    expect(out).toContain('Banco X');
    expect(out).toMatch(/10\.0%-18\.0%/);
    expect(out).toContain('6-24 meses');
  });

  test('lists requisitos tersely', () => {
    const out = formatProduct(PRODUCT);
    expect(out).toContain('documento:rut');
  });

  test('omits requisitos line when empty', () => {
    const out = formatProduct({ ...PRODUCT, requisitos: [] });
    expect(out).not.toMatch(/Requisitos/);
  });
});

describe('formatEvaluation', () => {
  test('shows score + each check status', () => {
    const out = formatEvaluation(EVALUATION);
    expect(out).toContain('Score determinista: 0.62');
    expect(out).toContain('cash_floor: FALLA');
    expect(out).toContain('projected_liquidity: OK');
    expect(out).toContain('equity_coverage: N/A');
  });

  test('lists manualChecks when present', () => {
    const out = formatEvaluation(EVALUATION);
    expect(out).toContain('rut: Cédula jurídica');
  });
});

describe('buildUserContext', () => {
  test('includes monto solicitado, uso, and each block', () => {
    const ctx = buildUserContext({
      summary: SUMMARY, product: PRODUCT, evaluation: EVALUATION,
      targetAmount: 50000, targetUse: 'siembra de maíz',
    });
    expect(ctx).toContain('Monto solicitado: 50000');
    expect(ctx).toContain('siembra de maíz');
    expect(ctx).toContain('Perfil financiero');
    expect(ctx).toContain('Producto de crédito');
    expect(ctx).toContain('Análisis determinista');
    expect(ctx).toContain('emit_credit_recommendation');
  });
});

// ─── parseClaudeResponse ──────────────────────────────────────────────────

function claudeReply(toolInput) {
  return {
    content: [
      { type: 'thinking', thinking: 'razonamiento...' },
      { type: 'tool_use', name: 'emit_credit_recommendation', input: toolInput },
    ],
  };
}

describe('parseClaudeResponse', () => {
  test('happy path: tomar', () => {
    const out = parseClaudeResponse(claudeReply({ recommendation: 'tomar', razon: 'flujo suficiente' }));
    expect(out.parsed.recommendation).toBe('tomar');
    expect(out.parsed.razon).toBe('flujo suficiente');
    expect(out.parsed.condiciones).toEqual([]);
  });

  test('tomar_condicional requires conditions', () => {
    const without = parseClaudeResponse(claudeReply({ recommendation: 'tomar_condicional', razon: 'depende' }));
    expect(without).toBeNull();

    const withConds = parseClaudeResponse(claudeReply({
      recommendation: 'tomar_condicional',
      razon: 'depende',
      condiciones: ['esperar 2 meses'],
    }));
    expect(withConds.parsed.recommendation).toBe('tomar_condicional');
    expect(withConds.parsed.condiciones).toEqual(['esperar 2 meses']);
  });

  test('rejects invalid recommendation value', () => {
    expect(parseClaudeResponse(claudeReply({ recommendation: 'maybe', razon: 'x' }))).toBeNull();
  });

  test('rejects empty razon', () => {
    expect(parseClaudeResponse(claudeReply({ recommendation: 'tomar', razon: '  ' }))).toBeNull();
  });

  test('returns null without tool_use block', () => {
    expect(parseClaudeResponse({ content: [{ type: 'text', text: 'hola' }] })).toBeNull();
  });

  test('passes through optional puntosACorregir', () => {
    const out = parseClaudeResponse(claudeReply({
      recommendation: 'no_tomar',
      razon: 'riesgo alto',
      puntosACorregir: ['flujo insuficiente', 'margen bajo'],
    }));
    expect(out.parsed.puntosACorregir).toEqual(['flujo insuficiente', 'margen bajo']);
  });
});

describe('SYSTEM_PROMPT', () => {
  test('instructs to use tool and stay conservative', () => {
    expect(SYSTEM_PROMPT).toMatch(/emit_credit_recommendation/);
    expect(SYSTEM_PROMPT).toMatch(/conservador/i);
  });
});
