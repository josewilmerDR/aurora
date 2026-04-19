// Unit tests for the debt ROI reasoner. Pure bits only — no HTTP.

const {
  SYSTEM_PROMPT,
  RECOMMENDATION_TOOL,
  buildUserContext,
  parseClaudeResponse,
  heuristicRecommendation,
  _internals: { formatScenarioLine, formatDelta },
} = require('../../lib/financing/debtRoiReasoner');

function fakeSimulation(overrides = {}) {
  const scenario = (name, margen, cashP50) => ({
    name,
    probabilidad: 0.33,
    margenProyectado: margen,
    percentiles: {
      cajaFinal: { p10: cashP50 - 500, p50: cashP50, p90: cashP50 + 500 },
      margen: { p10: margen - 100, p50: margen, p90: margen + 100 },
    },
    riesgos: [],
  });
  return {
    nTrials: 200,
    seed: 1,
    horizonteMeses: 12,
    debtCashFlow: { monthlyPayment: 500, totalInterest: 1000, truncated: false, remainingBalanceAtHorizon: 0 },
    withoutDebt: {
      scenarios: [scenario('Pesimista', 100, 1000), scenario('Base', 500, 5000), scenario('Optimista', 900, 9000)],
      resumen: { margenMedio: 500, cajaFinalMedia: 5000 },
    },
    withDebt: {
      scenarios: [scenario('Pesimista', 50, -200), scenario('Base', 600, 4500), scenario('Optimista', 1100, 8500)],
      resumen: { margenMedio: 600, cajaFinalMedia: 4500 },
    },
    delta: {
      byScenario: {
        Pesimista: { margen: { without: 100, withDebt: 50, delta: -50 }, cajaFinal: { without: 1000, withDebt: -200, delta: -1200 } },
        Base: { margen: { without: 500, withDebt: 600, delta: 100 }, cajaFinal: { without: 5000, withDebt: 4500, delta: -500 } },
        Optimista: { margen: { without: 900, withDebt: 1100, delta: 200 }, cajaFinal: { without: 9000, withDebt: 8500, delta: -500 } },
      },
      resumen: {
        margenMedio: { without: 500, withDebt: 600, delta: 100 },
        cajaFinalMedia: { without: 5000, withDebt: 4500, delta: -500 },
      },
    },
    warnings: [],
    ...overrides,
  };
}

// ─── Tool schema ──────────────────────────────────────────────────────────

describe('RECOMMENDATION_TOOL', () => {
  test('name + required fields', () => {
    expect(RECOMMENDATION_TOOL.name).toBe('emit_debt_recommendation');
    expect(RECOMMENDATION_TOOL.input_schema.required).toEqual(['recommendation', 'razon']);
  });

  test('enum covers all three verdicts', () => {
    const vals = RECOMMENDATION_TOOL.input_schema.properties.recommendation.enum;
    expect(vals.sort()).toEqual(['no_tomar', 'tomar', 'tomar_condicional']);
  });
});

describe('SYSTEM_PROMPT', () => {
  test('mentions the tool name and conservadurismo', () => {
    expect(SYSTEM_PROMPT).toContain('emit_debt_recommendation');
    expect(SYSTEM_PROMPT).toMatch(/conservador/i);
  });
});

// ─── Formatters ──────────────────────────────────────────────────────────

describe('formatScenarioLine', () => {
  test('includes margin + cash percentiles', () => {
    const out = formatScenarioLine({
      margenProyectado: 500,
      percentiles: { cajaFinal: { p10: 0, p50: 100, p90: 200 }, margen: { p10: 400, p50: 500, p90: 600 } },
    });
    expect(out).toContain('Margen mediano: 500');
    expect(out).toContain('Caja final p10/p50/p90: 0 / 100 / 200');
    expect(out).toContain('Margen p10/p50/p90: 400 / 500 / 600');
  });
});

describe('formatDelta', () => {
  test('renders one line per scenario + resumen', () => {
    const out = formatDelta(fakeSimulation().delta);
    expect(out).toContain('Pesimista');
    expect(out).toContain('Base');
    expect(out).toContain('Optimista');
    expect(out).toContain('Resumen');
  });
});

// ─── buildUserContext ────────────────────────────────────────────────────

describe('buildUserContext', () => {
  test('contains all major sections', () => {
    const ctx = buildUserContext({
      simulation: fakeSimulation(),
      debt: { amount: 10000, plazoMeses: 12, apr: 0.12, esquemaAmortizacion: 'cuota_fija' },
      useCase: null,
    });
    expect(ctx).toContain('# Simulación de ROI');
    expect(ctx).toContain('## Crédito evaluado');
    expect(ctx).toContain('## Escenarios SIN deuda');
    expect(ctx).toContain('## Escenarios CON deuda');
    expect(ctx).toContain('## Deltas');
    expect(ctx).toContain('emit_debt_recommendation');
  });

  test('surfaces TRUNCATED warning when present', () => {
    const sim = fakeSimulation();
    sim.debtCashFlow.truncated = true;
    sim.debtCashFlow.remainingBalanceAtHorizon = 2500;
    sim.warnings = ['TRUNCATED_AT_HORIZON:12:balance=2500'];
    const ctx = buildUserContext({
      simulation: sim, debt: { amount: 10000, plazoMeses: 24, apr: 0.12 }, useCase: null,
    });
    expect(ctx).toContain('TRUNCATED_AT_HORIZON');
    expect(ctx).toContain('2500');
  });

  test('includes useCase block when provided', () => {
    const ctx = buildUserContext({
      simulation: fakeSimulation(),
      debt: { amount: 10000, plazoMeses: 12, apr: 0.12 },
      useCase: {
        tipo: 'siembra',
        detalle: '10 hectáreas extra',
        expectedReturnModel: { kind: 'delayed_revenue', monthlyIncrease: 3000, startMonth: 3 },
      },
    });
    expect(ctx).toContain('## Uso declarado');
    expect(ctx).toContain('10 hectáreas extra');
    expect(ctx).toContain('delayed_revenue');
  });
});

// ─── parseClaudeResponse ─────────────────────────────────────────────────

function reply(toolInput) {
  return {
    content: [
      { type: 'thinking', thinking: 'razonando...' },
      { type: 'tool_use', name: 'emit_debt_recommendation', input: toolInput },
    ],
  };
}

describe('parseClaudeResponse', () => {
  test('happy path: tomar', () => {
    const out = parseClaudeResponse(reply({ recommendation: 'tomar', razon: 'mejora el margen' }));
    expect(out.parsed.recommendation).toBe('tomar');
  });

  test('tomar_condicional requires condiciones', () => {
    expect(parseClaudeResponse(reply({ recommendation: 'tomar_condicional', razon: 'x' }))).toBeNull();
    const ok = parseClaudeResponse(reply({
      recommendation: 'tomar_condicional', razon: 'x', condiciones: ['esperar 2 meses'],
    }));
    expect(ok.parsed.condiciones).toEqual(['esperar 2 meses']);
  });

  test('rejects unknown verdict', () => {
    expect(parseClaudeResponse(reply({ recommendation: 'quizas', razon: 'x' }))).toBeNull();
  });

  test('passes riesgoPrincipal when provided', () => {
    const out = parseClaudeResponse(reply({
      recommendation: 'tomar', razon: 'OK', riesgoPrincipal: 'volatilidad de precio',
    }));
    expect(out.parsed.riesgoPrincipal).toBe('volatilidad de precio');
  });
});

// ─── heuristicRecommendation ─────────────────────────────────────────────

describe('heuristicRecommendation', () => {
  test('no_tomar when pessimistic cash goes negative', () => {
    const out = heuristicRecommendation(fakeSimulation());
    expect(out.recommendation).toBe('no_tomar');
    expect(out.razon).toMatch(/pesimista/i);
  });

  test('no_tomar when margin delta ≤ 0', () => {
    const sim = fakeSimulation({
      withDebt: {
        scenarios: [
          { name: 'Pesimista', margenProyectado: 50, percentiles: { cajaFinal: { p10: 0, p50: 100, p90: 200 }, margen: {p10:0,p50:50,p90:100} } },
          { name: 'Base', margenProyectado: 300, percentiles: { cajaFinal: { p10: 0, p50: 100, p90: 200 }, margen:{p10:200,p50:300,p90:400} } },
          { name: 'Optimista', margenProyectado: 600, percentiles: { cajaFinal: { p10: 0, p50: 100, p90: 200 }, margen:{p10:500,p50:600,p90:700} } },
        ],
        resumen: { margenMedio: 300, cajaFinalMedia: 100 },
      },
      delta: { byScenario: {}, resumen: { margenMedio: { without: 500, withDebt: 300, delta: -200 }, cajaFinalMedia: { without: 0, withDebt: 0, delta: 0 } } },
    });
    const out = heuristicRecommendation(sim);
    expect(out.recommendation).toBe('no_tomar');
  });

  test('tomar_condicional when margin improves and pessimistic cash stays non-negative', () => {
    const sim = fakeSimulation({
      withDebt: {
        scenarios: [
          { name: 'Pesimista', margenProyectado: 100, percentiles: { cajaFinal: { p10: 0, p50: 200, p90: 400 }, margen:{p10:0,p50:100,p90:200} } },
          { name: 'Base', margenProyectado: 700, percentiles: { cajaFinal: { p10: 0, p50: 5000, p90: 10000 }, margen:{p10:500,p50:700,p90:900} } },
          { name: 'Optimista', margenProyectado: 1200, percentiles: { cajaFinal: { p10: 0, p50: 9000, p90: 14000 }, margen:{p10:1000,p50:1200,p90:1400} } },
        ],
        resumen: { margenMedio: 700, cajaFinalMedia: 5000 },
      },
      delta: { byScenario: {}, resumen: { margenMedio: { without: 500, withDebt: 700, delta: 200 }, cajaFinalMedia: { without: 5000, withDebt: 5000, delta: 0 } } },
    });
    const out = heuristicRecommendation(sim);
    expect(out.recommendation).toBe('tomar_condicional');
  });
});
