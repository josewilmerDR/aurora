// Unit tests for annualPlanGuardrails. Pure.

const {
  validateVersionCreation,
  checkForbiddenSideEffects,
  DEFAULT_WEEKLY_CAP,
} = require('../../lib/strategy/annualPlanGuardrails');

describe('validateVersionCreation — WEEKLY_CAP', () => {
  test('bloquea al alcanzar el cap', () => {
    const out = validateVersionCreation({
      weeklyCount: DEFAULT_WEEKLY_CAP,
      sectionsChanged: ['supuestos'],
      level: 'nivel1',
      newChangelogEntry: { razon: 'x' },
    });
    expect(out.allowed).toBe(false);
    expect(out.violations.some(v => v.code === 'WEEKLY_CAP')).toBe(true);
  });

  test('permite cuando weeklyCount < cap', () => {
    const out = validateVersionCreation({
      weeklyCount: 0,
      sectionsChanged: ['supuestos'],
      level: 'nivel1',
      newChangelogEntry: { razon: 'x' },
    });
    expect(out.allowed).toBe(true);
  });
});

describe('validateVersionCreation — CHANGELOG_GROWS', () => {
  test('bloquea cuando falta entrada de changelog', () => {
    const out = validateVersionCreation({
      weeklyCount: 0,
      sectionsChanged: [],
      level: 'nivel1',
      newChangelogEntry: null,
    });
    expect(out.violations.some(v => v.code === 'CHANGELOG_GROWS')).toBe(true);
  });
  test('bloquea cuando razon está vacía', () => {
    const out = validateVersionCreation({
      weeklyCount: 0,
      sectionsChanged: [],
      level: 'nivel1',
      newChangelogEntry: { razon: '' },
    });
    expect(out.violations.some(v => v.code === 'CHANGELOG_GROWS')).toBe(true);
  });
});

describe('validateVersionCreation — resolvedStatus por nivel', () => {
  const baseInput = {
    weeklyCount: 0,
    sectionsChanged: [],
    newChangelogEntry: { razon: 'x' },
  };

  test('N1 → siempre proposed', () => {
    expect(validateVersionCreation({ ...baseInput, level: 'nivel1' }).resolvedStatus).toBe('proposed');
  });

  test('N2 solo safe → active', () => {
    const out = validateVersionCreation({
      ...baseInput, level: 'nivel2',
      sectionsChanged: ['supuestos', 'hitos'],
    });
    expect(out.resolvedStatus).toBe('active');
    expect(out.touchesSensitive).toBe(false);
  });

  test('N2 con sensitive → proposed', () => {
    const out = validateVersionCreation({
      ...baseInput, level: 'nivel2',
      sectionsChanged: ['supuestos', 'cultivos'],
    });
    expect(out.resolvedStatus).toBe('proposed');
    expect(out.touchesSensitive).toBe(true);
  });

  test('N3 → siempre scheduled_activation (nunca inmediato)', () => {
    expect(validateVersionCreation({ ...baseInput, level: 'nivel3' }).resolvedStatus)
      .toBe('scheduled_activation');
    expect(validateVersionCreation({ ...baseInput, level: 'nivel3', sectionsChanged: ['cultivos'] }).resolvedStatus)
      .toBe('scheduled_activation');
  });

  test('manual → draft', () => {
    expect(validateVersionCreation({ ...baseInput, level: 'manual' }).resolvedStatus).toBe('draft');
  });
});

describe('checkForbiddenSideEffects', () => {
  test('permite secciones permitidas', () => {
    const out = checkForbiddenSideEffects({
      sections: { cultivos: [], supuestos: [] },
      diff: null,
    });
    expect(out.allowed).toBe(true);
  });

  test('bloquea "contrataciones" en sections', () => {
    const out = checkForbiddenSideEffects({
      sections: { contrataciones: [] },
      diff: null,
    });
    expect(out.allowed).toBe(false);
    expect(out.violations[0].code).toBe('FORBIDDEN_SECTION');
  });

  test('bloquea "compras" en sections', () => {
    const out = checkForbiddenSideEffects({
      sections: { compras: [] },
      diff: null,
    });
    expect(out.allowed).toBe(false);
  });

  test('bloquea en diff.added', () => {
    const out = checkForbiddenSideEffects({
      sections: {},
      diff: { added: { hiring: [] }, modified: {}, replaced: {} },
    });
    expect(out.allowed).toBe(false);
  });

  test('case-insensitive', () => {
    const out = checkForbiddenSideEffects({
      sections: { Contrataciones: [] },
      diff: null,
    });
    expect(out.allowed).toBe(false);
  });
});
