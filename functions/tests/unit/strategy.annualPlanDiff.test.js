// Unit tests for annualPlanDiff. Pure.

const { diffSections, summarizeDiff } = require('../../lib/strategy/annualPlanDiff');

describe('diffSections — identidad', () => {
  test('sections iguales → sin cambios', () => {
    const s = {
      cultivos: [{ loteId: 'L1', paqueteId: 'P1' }],
      supuestos: ['a'],
    };
    const d = diffSections(s, s);
    expect(d.sectionsChanged).toEqual([]);
    expect(Object.keys(d.added)).toHaveLength(0);
    expect(Object.keys(d.removed)).toHaveLength(0);
    expect(Object.keys(d.modified)).toHaveLength(0);
  });
});

describe('diffSections — cultivos', () => {
  test('detecta item agregado por loteId', () => {
    const d = diffSections(
      { cultivos: [{ loteId: 'L1', paqueteId: 'P1' }] },
      { cultivos: [{ loteId: 'L1', paqueteId: 'P1' }, { loteId: 'L2', paqueteId: 'P2' }] },
    );
    expect(d.sectionsChanged).toContain('cultivos');
    expect(d.added.cultivos).toHaveLength(1);
    expect(d.added.cultivos[0].loteId).toBe('L2');
  });

  test('detecta item quitado', () => {
    const d = diffSections(
      { cultivos: [{ loteId: 'L1', paqueteId: 'P1' }] },
      { cultivos: [] },
    );
    expect(d.removed.cultivos).toHaveLength(1);
  });

  test('detecta item modificado (mismo loteId, paqueteId distinto)', () => {
    const d = diffSections(
      { cultivos: [{ loteId: 'L1', paqueteId: 'P1' }] },
      { cultivos: [{ loteId: 'L1', paqueteId: 'P2' }] },
    );
    expect(d.modified.cultivos).toHaveLength(1);
    expect(d.modified.cultivos[0].prev.paqueteId).toBe('P1');
    expect(d.modified.cultivos[0].next.paqueteId).toBe('P2');
  });
});

describe('diffSections — rotaciones', () => {
  test('identifica por recommendationId', () => {
    const d = diffSections(
      { rotaciones: [{ loteId: 'L1', recommendationId: 'R1' }] },
      { rotaciones: [{ loteId: 'L1', recommendationId: 'R2' }] },
    );
    expect(d.added.rotaciones).toHaveLength(1);
    expect(d.removed.rotaciones).toHaveLength(1);
  });
});

describe('diffSections — hitos', () => {
  test('identifica por fecha+descripcion', () => {
    const d = diffSections(
      { hitos: [{ fecha: '2026-01-01', descripcion: 'A' }] },
      { hitos: [{ fecha: '2026-01-01', descripcion: 'A' }, { fecha: '2026-02-01', descripcion: 'B' }] },
    );
    expect(d.added.hitos).toHaveLength(1);
    expect(d.added.hitos[0].fecha).toBe('2026-02-01');
  });
});

describe('diffSections — supuestos', () => {
  test('detecta added/removed por equality', () => {
    const d = diffSections(
      { supuestos: ['a', 'b'] },
      { supuestos: ['a', 'c'] },
    );
    expect(d.added.supuestos).toEqual(['c']);
    expect(d.removed.supuestos).toEqual(['b']);
  });
});

describe('diffSections — presupuesto (replace)', () => {
  test('detecta cambio completo', () => {
    const d = diffSections(
      { presupuesto: { totalAsignado: 100 } },
      { presupuesto: { totalAsignado: 200 } },
    );
    expect(d.sectionsChanged).toContain('presupuesto');
    expect(d.replaced.presupuesto.prev.totalAsignado).toBe(100);
    expect(d.replaced.presupuesto.next.totalAsignado).toBe(200);
  });

  test('iguales → no cambio', () => {
    const d = diffSections(
      { presupuesto: { totalAsignado: 100 } },
      { presupuesto: { totalAsignado: 100 } },
    );
    expect(d.sectionsChanged).not.toContain('presupuesto');
  });
});

describe('diffSections — escenarioBase (replace)', () => {
  test('detecta cambio', () => {
    const d = diffSections(
      { escenarioBase: { scenarioId: 's1' } },
      { escenarioBase: { scenarioId: 's2' } },
    );
    expect(d.replaced.escenarioBase).toBeTruthy();
  });
});

describe('diffSections — inputs vacíos', () => {
  test('maneja undefined', () => {
    expect(diffSections(undefined, { supuestos: ['x'] }).added.supuestos).toEqual(['x']);
    expect(diffSections({ supuestos: ['x'] }, undefined).removed.supuestos).toEqual(['x']);
  });
});

describe('summarizeDiff', () => {
  test('"Sin cambios" cuando no hay diff', () => {
    expect(summarizeDiff({ sectionsChanged: [] })).toBe('Sin cambios.');
  });

  test('resumen legible con +/-/~', () => {
    const d = {
      sectionsChanged: ['cultivos', 'supuestos'],
      added: { cultivos: [{}], supuestos: ['x'] },
      removed: { supuestos: ['y'] },
      modified: { cultivos: [{}] },
      replaced: {},
    };
    const s = summarizeDiff(d);
    expect(s).toMatch(/cultivos:.*\+1.*~1/);
    expect(s).toMatch(/supuestos:.*\+1.*-1/);
  });

  test('escenarioBase renderiza como "actualizado"', () => {
    const d = {
      sectionsChanged: ['escenarioBase'],
      added: {}, removed: {}, modified: {},
      replaced: { escenarioBase: { prev: null, next: { scenarioId: 's1' } } },
    };
    expect(summarizeDiff(d)).toMatch(/escenarioBase: actualizado/);
  });
});
