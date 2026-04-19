// Unit tests for scenarioReasoner's pure pieces.

const {
  buildSystemPrompt,
  buildUserPrompt,
  findToolUse,
  TOOL_ANALIZAR,
  CLAUDE_MODEL,
} = require('../../lib/strategy/scenarioReasoner');

describe('buildSystemPrompt', () => {
  test('requires tool invocation + mentions robustness', () => {
    const s = buildSystemPrompt();
    expect(s).toMatch(/analizar_escenarios/);
    expect(s).toMatch(/robustez|robusto/i);
    expect(s).toMatch(/caja/i);
  });
});

describe('buildUserPrompt', () => {
  const simOutput = {
    nTrials: 500,
    seed: 42,
    context: { horizonteMeses: 12 },
    resumen: { ingresoMedio: 120000, costoMedio: 80000, margenMedio: 40000, cajaFinalMedia: 50000 },
    scenarios: [
      {
        name: 'Pesimista', probabilidad: 0.25,
        ingresoProyectado: 100000, costoProyectado: 82000, margenProyectado: 18000,
        percentiles: {
          ingreso: { p10: 95000, p50: 100000, p90: 105000 },
          margen: { p10: 10000, p50: 18000, p90: 25000 },
          cajaFinal: { p10: -5000, p50: 10000, p90: 20000 },
        },
        riesgos: ['Caja final p10 negativa'],
      },
      {
        name: 'Base', probabilidad: 0.5,
        ingresoProyectado: 120000, costoProyectado: 80000, margenProyectado: 40000,
        percentiles: {
          ingreso: { p10: 115000, p50: 120000, p90: 125000 },
          margen: { p10: 35000, p50: 40000, p90: 45000 },
          cajaFinal: { p10: 40000, p50: 50000, p90: 60000 },
        },
        riesgos: [],
      },
      {
        name: 'Optimista', probabilidad: 0.25,
        ingresoProyectado: 140000, costoProyectado: 78000, margenProyectado: 62000,
        percentiles: {
          ingreso: { p10: 135000, p50: 140000, p90: 145000 },
          margen: { p10: 55000, p50: 62000, p90: 70000 },
          cajaFinal: { p10: 60000, p50: 80000, p90: 100000 },
        },
        riesgos: ['Depende de precio sostenido'],
      },
    ],
  };

  test('lists all three scenario names', () => {
    const p = buildUserPrompt({ simulationOutput: simOutput, restrictions: {}, warnings: [] });
    expect(p).toMatch(/Pesimista/);
    expect(p).toMatch(/Base/);
    expect(p).toMatch(/Optimista/);
  });

  test('includes percentiles and probabilidad', () => {
    const p = buildUserPrompt({ simulationOutput: simOutput, restrictions: {}, warnings: [] });
    expect(p).toMatch(/50%/); // probabilidad of Base is 0.5 → 50%
    expect(p).toMatch(/p10/);
  });

  test('includes warnings when present', () => {
    const p = buildUserPrompt({
      simulationOutput: simOutput,
      restrictions: {},
      warnings: ['yield_no_income', 'cash_no_snapshots'],
    });
    expect(p).toMatch(/yield_no_income/);
    expect(p).toMatch(/cash_no_snapshots/);
  });

  test('includes restrictions when present', () => {
    const p = buildUserPrompt({
      simulationOutput: simOutput,
      restrictions: { maintainLoteIds: ['L1'] },
      warnings: [],
    });
    expect(p).toMatch(/maintainLoteIds/);
  });
});

describe('TOOL_ANALIZAR schema', () => {
  test('has required fields', () => {
    expect(TOOL_ANALIZAR.name).toBe('analizar_escenarios');
    expect(TOOL_ANALIZAR.input_schema.required).toEqual(expect.arrayContaining(['comentario', 'recomendacion']));
  });

  test('recomendacion sub-schema requires escenarioPreferido and razon', () => {
    const rec = TOOL_ANALIZAR.input_schema.properties.recomendacion;
    expect(rec.required).toEqual(expect.arrayContaining(['escenarioPreferido', 'razon']));
  });
});

describe('findToolUse', () => {
  test('returns matching tool_use block', () => {
    const resp = {
      content: [
        { type: 'thinking', thinking: '...' },
        { type: 'tool_use', name: 'other', input: {} },
        { type: 'tool_use', name: 'analizar_escenarios', input: { comentario: 'x' } },
      ],
    };
    const out = findToolUse(resp, 'analizar_escenarios');
    expect(out.input.comentario).toBe('x');
  });

  test('returns null when no match', () => {
    expect(findToolUse({ content: [] }, 'analizar_escenarios')).toBeNull();
    expect(findToolUse(null, 'analizar_escenarios')).toBeNull();
  });
});

describe('CLAUDE_MODEL', () => {
  test('is defined', () => {
    expect(typeof CLAUDE_MODEL).toBe('string');
    expect(CLAUDE_MODEL).toMatch(/claude/);
  });
});
