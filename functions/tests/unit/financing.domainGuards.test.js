// Unit tests for the financing domain guards. Pure — config is input only.

const {
  FINANCING_MAX_LEVEL,
  isFinancingDomainActive,
  resolveFinancingLevel,
  assertFinancingActive,
} = require('../../lib/financing/financingDomainGuards');

describe('isFinancingDomainActive', () => {
  test('default active when no config', () => {
    expect(isFinancingDomainActive(null)).toBe(true);
    expect(isFinancingDomainActive({})).toBe(true);
    expect(isFinancingDomainActive({ dominios: {} })).toBe(true);
  });

  test('default active when domain not configured', () => {
    expect(isFinancingDomainActive({ dominios: { procurement: { activo: false } } })).toBe(true);
  });

  test('explicitly inactive', () => {
    expect(isFinancingDomainActive({ dominios: { financing: { activo: false } } })).toBe(false);
  });

  test('explicitly active', () => {
    expect(isFinancingDomainActive({ dominios: { financing: { activo: true } } })).toBe(true);
  });

  test('missing activo key → active (default)', () => {
    expect(isFinancingDomainActive({ dominios: { financing: {} } })).toBe(true);
  });
});

describe('resolveFinancingLevel', () => {
  test('always returns nivel1 regardless of config', () => {
    expect(resolveFinancingLevel({}, 'nivel3')).toBe('nivel1');
    expect(resolveFinancingLevel({ dominios: { financing: { nivel: 'nivel3' } } }, 'nivel3')).toBe('nivel1');
    expect(resolveFinancingLevel({ dominios: { financing: { nivel: 'nivel2' } } }, 'off')).toBe('nivel1');
  });

  test('MAX level constant is nivel1', () => {
    expect(FINANCING_MAX_LEVEL).toBe('nivel1');
  });
});

describe('assertFinancingActive', () => {
  test('not blocked when active', () => {
    expect(assertFinancingActive(null)).toEqual({ blocked: false });
    expect(assertFinancingActive({ dominios: { financing: { activo: true } } })).toEqual({ blocked: false });
  });

  test('blocked with reason when disabled', () => {
    const out = assertFinancingActive({ dominios: { financing: { activo: false } } });
    expect(out.blocked).toBe(true);
    expect(out.reason).toMatch(/disabled/i);
  });
});
