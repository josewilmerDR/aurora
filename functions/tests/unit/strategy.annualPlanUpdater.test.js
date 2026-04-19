// Unit tests for annualPlanUpdater's pure helpers.

const {
  buildSystemPrompt,
  buildUserPrompt,
  findToolUse,
  mergeWithActiveSections,
  TOOL_PROPONER_PLAN,
  CLAUDE_MODEL,
} = require('../../lib/strategy/annualPlanUpdater');

describe('buildSystemPrompt', () => {
  test('incluye el nombre de la tool y prohíbe contrataciones/compras', () => {
    const s = buildSystemPrompt('nivel1');
    expect(s).toMatch(/proponer_plan_diff/);
    expect(s).toMatch(/contrataciones/);
    expect(s).toMatch(/compras/);
  });
  test('documenta el comportamiento del nivel elegido', () => {
    expect(buildSystemPrompt('nivel2')).toMatch(/seguras|safe/i);
    expect(buildSystemPrompt('nivel3')).toMatch(/24h|delay/i);
  });
});

describe('buildUserPrompt', () => {
  const ctx = {
    year: 2026,
    today: '2026-01-15',
    weeklyCount: 1,
    activePlan: {
      version: 3,
      createdAt: { _seconds: 1700000000 },
      sections: {
        cultivos: [{ loteId: 'L1', paqueteId: 'P1' }],
        rotaciones: [{ loteId: 'L1', recommendationId: 'R1' }],
        hitos: [{ fecha: '2026-02-01', descripcion: 'Inicio' }],
        supuestos: ['Precio estable'],
        presupuesto: { margenEsperado: 50000 },
        escenarioBase: { name: 'Base' },
      },
    },
    yield: {
      rows: [{ label: 'Tomate', margen: 10000, margenPct: 25, nCosechas: 5 }],
      resumen: {},
    },
    rotations: [{ loteId: 'L1', loteNombre: 'Norte', propuestas: [{}, {}], status: 'executed' }],
    latestScenario: {
      name: 'Plan Q1', resumen: { margenMedio: 40000 },
      claudeAnalysis: { recomendacion: { escenarioPreferido: 'Base' } },
    },
    recentSignals: [],
    recentAlerts: [{ title: 'Alerta: precio cayó 15%' }],
    budgets: [{ id: 'b1', categoria: 'Insumos', assignedAmount: 10000, period: '2026' }],
    warnings: ['plan_failed:x'],
  };

  test('incluye año y nivel', () => {
    const p = buildUserPrompt(ctx, 'nivel2');
    expect(p).toMatch(/2026/);
    expect(p).toMatch(/nivel2/);
  });
  test('lista secciones del plan activo', () => {
    const p = buildUserPrompt(ctx, 'nivel1');
    expect(p).toMatch(/Versión 3/);
    expect(p).toMatch(/cultivos: 1/);
  });
  test('lista rendimiento histórico cuando hay filas', () => {
    const p = buildUserPrompt(ctx, 'nivel1');
    expect(p).toMatch(/Tomate/);
  });
  test('incluye alertas recientes', () => {
    const p = buildUserPrompt(ctx, 'nivel1');
    expect(p).toMatch(/precio cayó 15%/);
  });
  test('incluye warnings', () => {
    const p = buildUserPrompt(ctx, 'nivel1');
    expect(p).toMatch(/plan_failed/);
  });
  test('tolera plan activo ausente', () => {
    const p = buildUserPrompt({ ...ctx, activePlan: null }, 'nivel1');
    expect(p).toMatch(/versión 1/);
  });
});

describe('TOOL_PROPONER_PLAN schema', () => {
  test('tiene razon + sections como required', () => {
    expect(TOOL_PROPONER_PLAN.name).toBe('proponer_plan_diff');
    expect(TOOL_PROPONER_PLAN.input_schema.required).toEqual(expect.arrayContaining(['razon', 'sections']));
  });
});

describe('findToolUse', () => {
  test('retorna el bloque correcto', () => {
    const resp = {
      content: [
        { type: 'thinking', thinking: 'x' },
        { type: 'tool_use', name: 'otra' },
        { type: 'tool_use', name: 'proponer_plan_diff', input: { razon: 'test' } },
      ],
    };
    expect(findToolUse(resp, 'proponer_plan_diff').input.razon).toBe('test');
  });
  test('retorna null cuando no hay match', () => {
    expect(findToolUse({ content: [] }, 'proponer_plan_diff')).toBeNull();
    expect(findToolUse(null, 'proponer_plan_diff')).toBeNull();
  });
});

describe('mergeWithActiveSections', () => {
  test('mantiene secciones omitidas por Claude', () => {
    const active = {
      cultivos: [{ loteId: 'L1', paqueteId: 'P1' }],
      supuestos: ['viejo'],
    };
    const proposed = { supuestos: ['nuevo'] };
    const merged = mergeWithActiveSections(active, proposed);
    expect(merged.supuestos).toEqual(['nuevo']);      // reemplazado
    expect(merged.cultivos).toHaveLength(1);          // preservado
    expect(merged.cultivos[0].loteId).toBe('L1');
  });

  test('crea secciones nuevas si no existían', () => {
    const merged = mergeWithActiveSections({}, { hitos: [{ fecha: '2026-01-01', descripcion: 'x' }] });
    expect(merged.hitos).toHaveLength(1);
  });

  test('tolera active vacío', () => {
    expect(mergeWithActiveSections(null, { supuestos: ['x'] })).toEqual({ supuestos: ['x'] });
    expect(mergeWithActiveSections(undefined, { supuestos: ['x'] })).toEqual({ supuestos: ['x'] });
  });
});

describe('CLAUDE_MODEL', () => {
  test('is defined', () => {
    expect(typeof CLAUDE_MODEL).toBe('string');
    expect(CLAUDE_MODEL).toMatch(/claude/);
  });
});
