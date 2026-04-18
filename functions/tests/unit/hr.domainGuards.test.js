// Unit tests for HR domain guards. Pure.

const {
  isHrDomainActive,
  resolveHrLevel,
  MAX_ALLOWED_LEVEL,
} = require('../../lib/hr/hrDomainGuards');

describe('isHrDomainActive', () => {
  test('defaults to active when config is absent', () => {
    expect(isHrDomainActive(null)).toBe(true);
    expect(isHrDomainActive(undefined)).toBe(true);
    expect(isHrDomainActive({})).toBe(true);
    expect(isHrDomainActive({ dominios: {} })).toBe(true);
    expect(isHrDomainActive({ dominios: { rrhh: {} } })).toBe(true);
  });

  test('respects explicit activo=false', () => {
    expect(isHrDomainActive({ dominios: { rrhh: { activo: false } } })).toBe(false);
  });

  test('activo=true keeps domain on', () => {
    expect(isHrDomainActive({ dominios: { rrhh: { activo: true } } })).toBe(true);
  });

  test('is independent from other dominios', () => {
    const cfg = { dominios: { financiera: { activo: false }, rrhh: { activo: true } } };
    expect(isHrDomainActive(cfg)).toBe(true);
  });
});

describe('resolveHrLevel', () => {
  test('MAX_ALLOWED_LEVEL is nivel2', () => {
    expect(MAX_ALLOWED_LEVEL).toBe('nivel2');
  });

  test('domain nivel wins when set', () => {
    expect(resolveHrLevel({ dominios: { rrhh: { nivel: 'nivel1' } } }, 'nivel2')).toBe('nivel1');
    expect(resolveHrLevel({ dominios: { rrhh: { nivel: 'nivel2' } } }, 'nivel1')).toBe('nivel2');
  });

  test('falls back to global mode when domain nivel is unset', () => {
    expect(resolveHrLevel({}, 'nivel1')).toBe('nivel1');
    expect(resolveHrLevel({}, 'nivel2')).toBe('nivel2');
    expect(resolveHrLevel(null, 'nivel1')).toBe('nivel1');
  });

  test('clamps domain nivel3 down to nivel2 (hard cap)', () => {
    expect(resolveHrLevel({ dominios: { rrhh: { nivel: 'nivel3' } } }, 'nivel1')).toBe('nivel2');
  });

  test('clamps global nivel3 down to nivel2 when domain nivel is unset', () => {
    expect(resolveHrLevel({}, 'nivel3')).toBe('nivel2');
    expect(resolveHrLevel({ dominios: { rrhh: {} } }, 'nivel3')).toBe('nivel2');
  });

  test('invalid nivel falls back to global mode (also clamped)', () => {
    expect(resolveHrLevel({ dominios: { rrhh: { nivel: 'super' } } }, 'nivel2')).toBe('nivel2');
    expect(resolveHrLevel({ dominios: { rrhh: { nivel: 42 } } }, 'nivel3')).toBe('nivel2');
  });

  test('defaults to "off" when nothing is configured', () => {
    expect(resolveHrLevel({}, undefined)).toBe('off');
    expect(resolveHrLevel({}, null)).toBe('off');
  });
});
