// Unit tests for procurement domain guards. Pure.

const {
  isProcurementDomainActive,
  resolveProcurementLevel,
} = require('../../lib/procurement/procurementDomainGuards');

describe('isProcurementDomainActive', () => {
  test('defaults to active when the domain is not configured', () => {
    expect(isProcurementDomainActive({})).toBe(true);
    expect(isProcurementDomainActive(undefined)).toBe(true);
    expect(isProcurementDomainActive({ dominios: {} })).toBe(true);
  });

  test('honors explicit activo: false as kill switch', () => {
    expect(isProcurementDomainActive({ dominios: { procurement: { activo: false } } })).toBe(false);
  });

  test('explicit activo: true keeps it active', () => {
    expect(isProcurementDomainActive({ dominios: { procurement: { activo: true } } })).toBe(true);
  });
});

describe('resolveProcurementLevel', () => {
  test('domain nivel overrides global mode', () => {
    expect(resolveProcurementLevel({ dominios: { procurement: { nivel: 'nivel3' } } }, 'nivel1'))
      .toBe('nivel3');
  });

  test('falls back to global mode when domain nivel is unset', () => {
    expect(resolveProcurementLevel({}, 'nivel2')).toBe('nivel2');
  });

  test('invalid nivel falls back to global mode', () => {
    expect(resolveProcurementLevel({ dominios: { procurement: { nivel: 'invalid' } } }, 'nivel1'))
      .toBe('nivel1');
  });

  test('defaults to off when nothing is configured', () => {
    expect(resolveProcurementLevel({}, undefined)).toBe('off');
  });
});
