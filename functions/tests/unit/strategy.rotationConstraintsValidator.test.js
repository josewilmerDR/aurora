// Unit tests for rotationConstraintsValidator. Pure — no Firestore.

const {
  validateConstraintPayload,
  normalizeConstraintPayload,
  LIMITS,
} = require('../../lib/strategy/rotationConstraintsValidator');

describe('validateConstraintPayload', () => {
  test('accepts a valid minimal payload', () => {
    expect(validateConstraintPayload({
      cultivo: 'Tomate',
      familiaBotanica: 'Solanaceae',
    })).toBeNull();
  });

  test('rejects missing cultivo', () => {
    expect(validateConstraintPayload({ familiaBotanica: 'Solanaceae' }))
      .toMatch(/cultivo is required/);
  });

  test('rejects missing familiaBotanica', () => {
    expect(validateConstraintPayload({ cultivo: 'Tomate' }))
      .toMatch(/familiaBotanica is required/);
  });

  test('allows partial with only some fields', () => {
    expect(validateConstraintPayload({ descansoMinDias: 30 }, { partial: true })).toBeNull();
  });

  test('rejects non-integer descansoMinCiclos', () => {
    expect(validateConstraintPayload({
      cultivo: 'Tomate', familiaBotanica: 'Solanaceae', descansoMinCiclos: 1.5,
    })).toMatch(/descansoMinCiclos/);
  });

  test('rejects descansoMinCiclos above cap', () => {
    expect(validateConstraintPayload({
      cultivo: 'Tomate', familiaBotanica: 'Solanaceae',
      descansoMinCiclos: LIMITS.DESCANSO_CICLOS_MAX + 1,
    })).toMatch(/descansoMinCiclos/);
  });

  test('rejects descansoMinDias above cap', () => {
    expect(validateConstraintPayload({
      cultivo: 'Tomate', familiaBotanica: 'Solanaceae',
      descansoMinDias: LIMITS.DESCANSO_DIAS_MAX + 1,
    })).toMatch(/descansoMinDias/);
  });

  test('rejects negative numbers', () => {
    expect(validateConstraintPayload({
      cultivo: 'Tomate', familiaBotanica: 'Solanaceae',
      descansoMinCiclos: -1,
    })).toMatch(/descansoMinCiclos/);
  });

  test('rejects non-array incompatibleCon', () => {
    expect(validateConstraintPayload({
      cultivo: 'Tomate', familiaBotanica: 'Solanaceae',
      incompatibleCon: 'papa',
    })).toMatch(/incompatibleCon/);
  });

  test('rejects empty cultivo string', () => {
    expect(validateConstraintPayload({
      cultivo: '', familiaBotanica: 'Solanaceae',
    })).toMatch(/cultivo is required/);
  });

  test('rejects oversized notas', () => {
    expect(validateConstraintPayload({
      cultivo: 'Tomate', familiaBotanica: 'Solanaceae',
      notas: 'x'.repeat(LIMITS.NOTAS_MAX + 1),
    })).toMatch(/notas/);
  });
});

describe('normalizeConstraintPayload', () => {
  test('trims strings and truncates to limits', () => {
    const out = normalizeConstraintPayload({
      cultivo: '  Tomate  ',
      familiaBotanica: 'Solanaceae',
      descansoMinCiclos: 2,
      descansoMinDias: 30,
      incompatibleCon: ['papa', 'PAPA', '', 'berenjena', '   '],
      notas: 'Test',
    });
    expect(out.cultivo).toBe('Tomate');
    expect(out.familiaBotanica).toBe('Solanaceae');
    expect(out.descansoMinCiclos).toBe(2);
    expect(out.descansoMinDias).toBe(30);
    // Deduplica case-insensitive y descarta vacíos.
    expect(out.incompatibleCon).toEqual(['papa', 'berenjena']);
    expect(out.notas).toBe('Test');
  });

  test('caps incompatibleCon length', () => {
    const many = Array.from({ length: LIMITS.INCOMPAT_MAX + 5 }, (_, i) => `c${i}`);
    const out = normalizeConstraintPayload({
      cultivo: 'X', familiaBotanica: 'Y', incompatibleCon: many,
    });
    expect(out.incompatibleCon.length).toBe(LIMITS.INCOMPAT_MAX);
  });

  test('handles missing optional fields', () => {
    const out = normalizeConstraintPayload({ cultivo: 'X', familiaBotanica: 'Y' });
    expect(out.cultivo).toBe('X');
    expect(out.familiaBotanica).toBe('Y');
    expect(out.descansoMinCiclos).toBeUndefined();
    expect(out.descansoMinDias).toBeUndefined();
    expect(out.incompatibleCon).toBeUndefined();
  });

  test('converts notas=null', () => {
    const out = normalizeConstraintPayload({
      cultivo: 'X', familiaBotanica: 'Y', notas: null,
    });
    expect(out.notas).toBeNull();
  });
});

describe('LIMITS is frozen', () => {
  test('cannot be mutated', () => {
    expect(Object.isFrozen(LIMITS)).toBe(true);
  });
});
