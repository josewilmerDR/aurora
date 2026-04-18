// Unit tests for finance domain guards. Pure.

const {
  isFinancialDomainActive,
  checkMaxDeviation,
  resolveDomainLevel,
} = require('../../lib/finance/financeDomainGuards');

describe('isFinancialDomainActive', () => {
  test('defaults to active when config is absent', () => {
    expect(isFinancialDomainActive(null)).toBe(true);
    expect(isFinancialDomainActive(undefined)).toBe(true);
    expect(isFinancialDomainActive({})).toBe(true);
    expect(isFinancialDomainActive({ dominios: {} })).toBe(true);
    expect(isFinancialDomainActive({ dominios: { financiera: {} } })).toBe(true);
  });

  test('respects explicit activo=false', () => {
    expect(isFinancialDomainActive({ dominios: { financiera: { activo: false } } })).toBe(false);
  });

  test('activo=true keeps domain on', () => {
    expect(isFinancialDomainActive({ dominios: { financiera: { activo: true } } })).toBe(true);
  });
});

describe('checkMaxDeviation', () => {
  test('permissive when maxPct is null/undefined', () => {
    expect(checkMaxDeviation({ amount: 1000, sourceAssigned: 100, maxPct: null }).ok).toBe(true);
    expect(checkMaxDeviation({ amount: 1000, sourceAssigned: 100, maxPct: undefined }).ok).toBe(true);
  });

  test('permissive when sourceAssigned is 0', () => {
    // Delegamos al validator principal que ya detecta el overdraft.
    expect(checkMaxDeviation({ amount: 100, sourceAssigned: 0, maxPct: 20 }).ok).toBe(true);
  });

  test('passes when amount is within cap', () => {
    const out = checkMaxDeviation({ amount: 100, sourceAssigned: 1000, maxPct: 25 });
    expect(out.ok).toBe(true); // 10% ≤ 25%
  });

  test('blocks when amount exceeds cap', () => {
    const out = checkMaxDeviation({ amount: 300, sourceAssigned: 1000, maxPct: 25 });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/30\.0%/);
    expect(out.reason).toMatch(/tope de 25%/);
  });

  test('edge: exactly at cap → passes', () => {
    const out = checkMaxDeviation({ amount: 250, sourceAssigned: 1000, maxPct: 25 });
    expect(out.ok).toBe(true);
  });

  test('rejects when maxPct is not a finite number', () => {
    // Interpretado como "no cap" — permisivo.
    expect(checkMaxDeviation({ amount: 1000, sourceAssigned: 100, maxPct: 'abc' }).ok).toBe(true);
  });
});

describe('resolveDomainLevel', () => {
  test('falls through to global mode when domain level is absent', () => {
    expect(resolveDomainLevel({}, 'nivel2')).toBe('nivel2');
    expect(resolveDomainLevel(null, 'nivel3')).toBe('nivel3');
    expect(resolveDomainLevel({ dominios: { financiera: {} } }, 'nivel1')).toBe('nivel1');
  });

  test('uses domain-specific level when set', () => {
    expect(resolveDomainLevel({ dominios: { financiera: { nivel: 'nivel1' } } }, 'nivel3')).toBe('nivel1');
    expect(resolveDomainLevel({ dominios: { financiera: { nivel: 'nivel3' } } }, 'nivel1')).toBe('nivel3');
  });

  test('ignores invalid domain level values', () => {
    expect(resolveDomainLevel({ dominios: { financiera: { nivel: 'super' } } }, 'nivel2')).toBe('nivel2');
    expect(resolveDomainLevel({ dominios: { financiera: { nivel: 42 } } }, 'nivel2')).toBe('nivel2');
  });

  test('defaults to "off" when nothing is set', () => {
    expect(resolveDomainLevel({}, null)).toBe('off');
    expect(resolveDomainLevel({}, undefined)).toBe('off');
  });
});
