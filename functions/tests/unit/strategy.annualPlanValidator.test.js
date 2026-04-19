// Unit tests for annualPlanValidator. Pure.

const {
  validateAnnualPlanPayload,
  validateSections,
  SAFE_SECTIONS,
  SENSITIVE_SECTIONS,
  LIMITS,
} = require('../../lib/strategy/annualPlanValidator');

describe('validateAnnualPlanPayload', () => {
  test('accepts minimal valid payload', () => {
    expect(validateAnnualPlanPayload({
      year: 2026,
      sections: { supuestos: ['Precio estable'] },
    })).toBeNull();
  });

  test('rejects missing year', () => {
    expect(validateAnnualPlanPayload({ sections: {} })).toMatch(/year/);
  });

  test('rejects non-integer year', () => {
    expect(validateAnnualPlanPayload({ year: 2026.5, sections: {} })).toMatch(/year/);
  });

  test('rejects year out of range', () => {
    expect(validateAnnualPlanPayload({ year: 2010, sections: {} })).toMatch(/year/);
    expect(validateAnnualPlanPayload({ year: 2100, sections: {} })).toMatch(/year/);
  });

  test('rejects missing sections', () => {
    expect(validateAnnualPlanPayload({ year: 2026 })).toMatch(/sections/);
  });

  test('partial mode allows omitting year or sections', () => {
    expect(validateAnnualPlanPayload({ sections: {} }, { partial: true })).toBeNull();
    expect(validateAnnualPlanPayload({ year: 2026 }, { partial: true })).toBeNull();
  });
});

describe('validateSections — unknown section', () => {
  test('rejects unknown section key', () => {
    expect(validateSections({ surprise: [] })).toMatch(/Unknown section/);
  });
});

describe('validateSections — cultivos', () => {
  test('valid array', () => {
    expect(validateSections({
      cultivos: [
        { loteId: 'L1', paqueteId: 'P1', fechaEstimada: '2026-03-15' },
      ],
    })).toBeNull();
  });
  test('rejects missing loteId', () => {
    expect(validateSections({ cultivos: [{ paqueteId: 'P1' }] })).toMatch(/loteId/);
  });
  test('rejects missing paqueteId', () => {
    expect(validateSections({ cultivos: [{ loteId: 'L1' }] })).toMatch(/paqueteId/);
  });
  test('rejects invalid fechaEstimada format', () => {
    expect(validateSections({ cultivos: [{ loteId: 'L1', paqueteId: 'P1', fechaEstimada: '2026/03/15' }] })).toMatch(/fechaEstimada/);
  });
  test('rejects oversized array', () => {
    const arr = Array.from({ length: LIMITS.cultivosMax + 1 }, (_, i) => ({ loteId: `L${i}`, paqueteId: 'P' }));
    expect(validateSections({ cultivos: arr })).toMatch(/cultivos cannot exceed/);
  });
});

describe('validateSections — rotaciones', () => {
  test('valid array', () => {
    expect(validateSections({
      rotaciones: [{ loteId: 'L1', recommendationId: 'R1', summary: 'x' }],
    })).toBeNull();
  });
  test('rejects missing recommendationId', () => {
    expect(validateSections({ rotaciones: [{ loteId: 'L1' }] })).toMatch(/recommendationId/);
  });
});

describe('validateSections — hitos', () => {
  test('valid array', () => {
    expect(validateSections({ hitos: [{ fecha: '2026-03-15', descripcion: 'Inicio ciclo' }] })).toBeNull();
  });
  test('rejects invalid fecha', () => {
    expect(validateSections({ hitos: [{ fecha: 'bad', descripcion: 'x' }] })).toMatch(/fecha/);
  });
  test('rejects empty descripcion', () => {
    expect(validateSections({ hitos: [{ fecha: '2026-01-01', descripcion: '' }] })).toMatch(/descripcion/);
  });
});

describe('validateSections — supuestos', () => {
  test('valid array of strings', () => {
    expect(validateSections({ supuestos: ['a', 'b'] })).toBeNull();
  });
  test('rejects non-string item', () => {
    expect(validateSections({ supuestos: ['a', 42] })).toMatch(/supuestos/);
  });
});

describe('validateSections — presupuesto', () => {
  test('valid', () => {
    expect(validateSections({
      presupuesto: {
        totalAsignado: 100000,
        ingresoEsperado: 200000,
        margenEsperado: 50000,
        budgetsSnapshot: [{ id: 'b1', categoria: 'x', monto: 100 }],
      },
    })).toBeNull();
  });
  test('rejects non-finite numbers', () => {
    expect(validateSections({ presupuesto: { totalAsignado: 'abc' } })).toMatch(/totalAsignado/);
  });
});

describe('validateSections — escenarioBase', () => {
  test('valid', () => {
    expect(validateSections({ escenarioBase: { scenarioId: 's1', name: 'Base' } })).toBeNull();
  });
  test('rejects empty scenarioId', () => {
    expect(validateSections({ escenarioBase: { scenarioId: '' } })).toMatch(/scenarioId/);
  });
});

describe('SAFE vs SENSITIVE sets', () => {
  test('disjoint', () => {
    for (const s of SAFE_SECTIONS) expect(SENSITIVE_SECTIONS.has(s)).toBe(false);
    for (const s of SENSITIVE_SECTIONS) expect(SAFE_SECTIONS.has(s)).toBe(false);
  });
  test('SAFE contains supuestos + hitos + escenarioBase', () => {
    expect(SAFE_SECTIONS.has('supuestos')).toBe(true);
    expect(SAFE_SECTIONS.has('hitos')).toBe(true);
    expect(SAFE_SECTIONS.has('escenarioBase')).toBe(true);
  });
  test('SENSITIVE contains cultivos + rotaciones + presupuesto', () => {
    expect(SENSITIVE_SECTIONS.has('cultivos')).toBe(true);
    expect(SENSITIVE_SECTIONS.has('rotaciones')).toBe(true);
    expect(SENSITIVE_SECTIONS.has('presupuesto')).toBe(true);
  });
});
