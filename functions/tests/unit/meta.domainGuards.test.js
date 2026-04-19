// Unit tests for the meta domain guards — Fase 6.1.

const {
  isMetaDomainActive,
  resolveMetaLevel,
  assertMetaActive,
  VALID_LEVELS,
} = require('../../lib/meta/metaDomainGuards');

describe('isMetaDomainActive', () => {
  test('default active when no config', () => {
    expect(isMetaDomainActive(null)).toBe(true);
    expect(isMetaDomainActive({})).toBe(true);
    expect(isMetaDomainActive({ dominios: {} })).toBe(true);
  });

  test('default active when meta key absent', () => {
    expect(isMetaDomainActive({ dominios: { finance: { activo: false } } })).toBe(true);
  });

  test('explicitly inactive', () => {
    expect(isMetaDomainActive({ dominios: { meta: { activo: false } } })).toBe(false);
  });

  test('explicitly active', () => {
    expect(isMetaDomainActive({ dominios: { meta: { activo: true } } })).toBe(true);
  });

  test('missing activo key → active (default)', () => {
    expect(isMetaDomainActive({ dominios: { meta: {} } })).toBe(true);
  });
});

describe('resolveMetaLevel', () => {
  test('falls back to global mode when domain has no nivel', () => {
    expect(resolveMetaLevel({}, 'nivel2')).toBe('nivel2');
    expect(resolveMetaLevel({ dominios: {} }, 'nivel3')).toBe('nivel3');
  });

  test('domain nivel wins over global', () => {
    expect(resolveMetaLevel({ dominios: { meta: { nivel: 'nivel1' } } }, 'nivel3')).toBe('nivel1');
    expect(resolveMetaLevel({ dominios: { meta: { nivel: 'nivel2' } } }, 'off')).toBe('nivel2');
  });

  test('defaults to off when no valid config given', () => {
    expect(resolveMetaLevel(null, null)).toBe('off');
    expect(resolveMetaLevel({}, 'bogus')).toBe('off');
  });

  test('rejects invalid domain nivel and falls back to global', () => {
    expect(resolveMetaLevel({ dominios: { meta: { nivel: 'bogus' } } }, 'nivel2')).toBe('nivel2');
  });

  test('accepts all valid tiers: off/nivel1/nivel2/nivel3', () => {
    for (const n of VALID_LEVELS) {
      expect(resolveMetaLevel({ dominios: { meta: { nivel: n } } }, 'off')).toBe(n);
    }
  });
});

describe('assertMetaActive', () => {
  test('not blocked when active', () => {
    expect(assertMetaActive(null)).toEqual({ blocked: false });
    expect(assertMetaActive({ dominios: { meta: { activo: true } } })).toEqual({ blocked: false });
  });

  test('blocked with reason when disabled', () => {
    const out = assertMetaActive({ dominios: { meta: { activo: false } } });
    expect(out.blocked).toBe(true);
    expect(out.reason).toMatch(/disabled/i);
  });
});
