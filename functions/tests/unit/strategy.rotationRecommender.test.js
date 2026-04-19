// Unit tests for rotationRecommender's pure helpers (prompt builder, parser).
// The live Claude call is NOT exercised here — only the pure logic.

const {
  buildSystemPrompt,
  buildUserPrompt,
  normalizeClaudePropuestas,
  enrichWithFamilia,
  findToolUseBlock,
  TOOL_PROPONER_ROTACION,
  CLAUDE_MODEL,
} = require('../../lib/strategy/rotationRecommender');

describe('buildSystemPrompt', () => {
  test('includes the key hard rules', () => {
    const s = buildSystemPrompt();
    expect(s).toMatch(/rotación/i);
    expect(s).toMatch(/proponer_rotacion/);
    expect(s).toMatch(/descanso/i);
    expect(s).toMatch(/incompatible/i);
  });
});

describe('buildUserPrompt', () => {
  const ctx = {
    lote: { id: 'L1', nombreLote: 'Lote Norte', hectareas: 5 },
    horizonteCiclos: 3,
    paquetes: [
      { id: 'P1', nombrePaquete: 'Tomate A', tipoCosecha: 'I Cosecha', etapaCultivo: 'Desarrollo' },
      { id: 'P2', nombrePaquete: 'Lechuga B', tipoCosecha: 'II Cosecha', etapaCultivo: 'Postforza' },
    ],
    constraints: [
      { cultivo: 'I Cosecha', familiaBotanica: 'Solanaceae', descansoMinCiclos: 2, descansoMinDias: 30, incompatibleCon: [] },
    ],
    historial: [
      { fecha: '2024-01-01', paqueteId: 'P1', paqueteNombre: 'Tomate A', cerrado: true, fechaCierre: '2024-05-01' },
    ],
    yieldRows: [
      { label: 'Tomate A', kgPorHa: 15000, margen: 5000, margenPct: 40, nCosechas: 8 },
    ],
    temporadas: [
      { nombre: '2024-A', fechaInicio: '2024-01-01', fechaFin: '2024-06-30' },
    ],
    today: '2025-01-15',
  };

  test('includes finca context', () => {
    const p = buildUserPrompt(ctx);
    expect(p).toMatch(/Lote Norte/);
    expect(p).toMatch(/5 ha/);
    expect(p).toMatch(/3 ciclos/);
  });

  test('lists all packages with id', () => {
    const p = buildUserPrompt(ctx);
    expect(p).toMatch(/id=P1/);
    expect(p).toMatch(/id=P2/);
    expect(p).toMatch(/Tomate A/);
  });

  test('handles empty constraints with explicit note', () => {
    const p = buildUserPrompt({ ...ctx, constraints: [] });
    expect(p).toMatch(/vacío/);
  });

  test('handles empty historial', () => {
    const p = buildUserPrompt({ ...ctx, historial: [] });
    expect(p).toMatch(/sin siembras previas/i);
  });

  test('handles empty yield rows gracefully', () => {
    const p = buildUserPrompt({ ...ctx, yieldRows: [] });
    expect(p).toMatch(/sin datos agregados/i);
  });

  test('lists temporadas when present', () => {
    const p = buildUserPrompt(ctx);
    expect(p).toMatch(/2024-A/);
  });
});

describe('TOOL_PROPONER_ROTACION', () => {
  test('has correct name and required fields', () => {
    expect(TOOL_PROPONER_ROTACION.name).toBe('proponer_rotacion');
    expect(TOOL_PROPONER_ROTACION.input_schema.required).toContain('propuestas');
    const itemSchema = TOOL_PROPONER_ROTACION.input_schema.properties.propuestas.items;
    expect(itemSchema.required).toEqual(expect.arrayContaining(['orden', 'paqueteId', 'fechaSiembra', 'razon']));
  });
});

describe('findToolUseBlock', () => {
  test('returns the matching tool_use block', () => {
    const resp = {
      content: [
        { type: 'thinking', thinking: 'reasoning...' },
        { type: 'tool_use', name: 'otra_tool', input: {} },
        { type: 'tool_use', name: 'proponer_rotacion', input: { propuestas: [] } },
      ],
    };
    const out = findToolUseBlock(resp, 'proponer_rotacion');
    expect(out.name).toBe('proponer_rotacion');
  });

  test('returns null when not found', () => {
    expect(findToolUseBlock({ content: [] }, 'proponer_rotacion')).toBeNull();
    expect(findToolUseBlock(null, 'proponer_rotacion')).toBeNull();
  });
});

describe('normalizeClaudePropuestas', () => {
  const paquetesById = {
    P1: { id: 'P1', nombrePaquete: 'Tomate A', tipoCosecha: 'I Cosecha' },
    P2: { id: 'P2', nombrePaquete: 'Lechuga B', tipoCosecha: 'II Cosecha' },
  };

  test('normalizes valid propuestas', () => {
    const raw = [
      { orden: 1, paqueteId: 'P1', fechaSiembra: '2024-06-01', duracionEstimadaDias: 120, razon: 'Mejor margen.' },
      { orden: 2, paqueteId: 'P2', fechaSiembra: '2024-10-01', razon: 'Rompe monocultivo.' },
    ];
    const out = normalizeClaudePropuestas(raw, { paquetesById });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      orden: 1,
      paqueteId: 'P1',
      nombrePaquete: 'Tomate A',
      tipoCosecha: 'I Cosecha',
      cultivo: 'I Cosecha',
      fechaSiembra: '2024-06-01',
      duracionEstimadaDias: 120,
    });
    expect(out[1].paqueteId).toBe('P2');
  });

  test('null paqueteId when package not in catalog', () => {
    const raw = [{ orden: 1, paqueteId: 'P-UNKNOWN', fechaSiembra: '2024-06-01', razon: 'x' }];
    const out = normalizeClaudePropuestas(raw, { paquetesById });
    expect(out[0].paqueteId).toBeNull();
    expect(out[0].nombrePaquete).toBeNull();
  });

  test('handles missing orden with fallback index+1', () => {
    const raw = [
      { paqueteId: 'P1', fechaSiembra: '2024-06-01', razon: 'x' },
      { paqueteId: 'P2', fechaSiembra: '2024-10-01', razon: 'y' },
    ];
    const out = normalizeClaudePropuestas(raw, { paquetesById });
    expect(out[0].orden).toBe(1);
    expect(out[1].orden).toBe(2);
  });

  test('clamps unreasonable duracionEstimadaDias', () => {
    const raw = [{ orden: 1, paqueteId: 'P1', fechaSiembra: '2024-06-01', duracionEstimadaDias: 999999, razon: 'x' }];
    const out = normalizeClaudePropuestas(raw, { paquetesById });
    expect(out[0].duracionEstimadaDias).toBeLessThanOrEqual(365 * 5);
  });

  test('truncates long razon', () => {
    const raw = [{ orden: 1, paqueteId: 'P1', fechaSiembra: '2024-06-01', razon: 'x'.repeat(5000) }];
    const out = normalizeClaudePropuestas(raw, { paquetesById });
    expect(out[0].razon.length).toBeLessThanOrEqual(1024);
  });

  test('returns [] for non-array input', () => {
    expect(normalizeClaudePropuestas(null, { paquetesById })).toEqual([]);
    expect(normalizeClaudePropuestas(undefined, { paquetesById })).toEqual([]);
  });
});

describe('enrichWithFamilia', () => {
  test('fills familiaBotanica from constraints when missing', () => {
    const constraintsByCultivo = {
      'i cosecha': { familiaBotanica: 'Solanaceae' },
    };
    const out = enrichWithFamilia(
      [{ cultivo: 'I Cosecha', fechaSiembra: '2024-06-01' }],
      constraintsByCultivo,
    );
    expect(out[0].familiaBotanica).toBe('Solanaceae');
  });

  test('preserves existing familiaBotanica', () => {
    const out = enrichWithFamilia(
      [{ cultivo: 'X', familiaBotanica: 'Asteraceae' }],
      { x: { familiaBotanica: 'Solanaceae' } },
    );
    expect(out[0].familiaBotanica).toBe('Asteraceae');
  });

  test('leaves null when no constraint matches', () => {
    const out = enrichWithFamilia(
      [{ cultivo: 'Nada' }],
      {},
    );
    expect(out[0].familiaBotanica).toBeUndefined();
  });
});

describe('CLAUDE_MODEL constant', () => {
  test('is a Claude sonnet identifier string', () => {
    expect(typeof CLAUDE_MODEL).toBe('string');
    expect(CLAUDE_MODEL).toMatch(/claude/);
  });
});
