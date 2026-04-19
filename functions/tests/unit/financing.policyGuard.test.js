// Unit tests for the Fase 5.5 Nivel-1 policy guard. Pure — no Firestore.

const {
  FINANCING_MAX_LEVEL,
  FORBIDDEN_ACTION_TYPES,
  assertNivelAllowed,
} = require('../../lib/financing/financingDomainGuards');

describe('assertNivelAllowed', () => {
  test('allows nivel1', () => {
    expect(assertNivelAllowed('nivel1')).toEqual({ blocked: false });
  });

  test('blocks nivel2 with a descriptive reason', () => {
    const out = assertNivelAllowed('nivel2');
    expect(out.blocked).toBe(true);
    expect(out.reason).toMatch(/Nivel 1 only/);
    expect(out.reason).toMatch(/financing-autonomy\.md/);
  });

  test('blocks nivel3', () => {
    expect(assertNivelAllowed('nivel3').blocked).toBe(true);
  });

  test('blocks "off" — N1 is the minimum enforceable level here', () => {
    expect(assertNivelAllowed('off').blocked).toBe(true);
  });

  test('blocks empty / null / undefined', () => {
    expect(assertNivelAllowed('').blocked).toBe(true);
    expect(assertNivelAllowed(null).blocked).toBe(true);
    expect(assertNivelAllowed(undefined).blocked).toBe(true);
  });

  test('blocks unknown strings', () => {
    expect(assertNivelAllowed('nivel4').blocked).toBe(true);
    expect(assertNivelAllowed('autonomous').blocked).toBe(true);
  });
});

describe('FINANCING_MAX_LEVEL', () => {
  test('is literally nivel1', () => {
    expect(FINANCING_MAX_LEVEL).toBe('nivel1');
  });
});

describe('FORBIDDEN_ACTION_TYPES', () => {
  test('covers the canonical financing-action names', () => {
    // A non-exhaustive but canonical set — if a contributor renames these,
    // they'll also have to touch this test, which is the friction we want.
    expect(FORBIDDEN_ACTION_TYPES).toContain('aplicar_credito');
    expect(FORBIDDEN_ACTION_TYPES).toContain('solicitar_credito');
    expect(FORBIDDEN_ACTION_TYPES).toContain('tomar_prestamo');
    expect(FORBIDDEN_ACTION_TYPES).toContain('contratar_deuda');
  });

  test('is frozen — no runtime mutation', () => {
    expect(Object.isFrozen(FORBIDDEN_ACTION_TYPES)).toBe(true);
  });
});
