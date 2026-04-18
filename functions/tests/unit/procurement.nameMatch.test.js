// Unit tests for supplier name matching. Pure.

const { normalizeName, matchesSupplier } = require('../../lib/procurement/supplierNameMatch');

describe('normalizeName', () => {
  test('lowercases, trims, collapses whitespace', () => {
    expect(normalizeName('  Agro   Insumos  ')).toBe('agro insumos');
  });

  test('strips diacritics', () => {
    expect(normalizeName('Químicos Pérez')).toBe('quimicos perez');
  });

  test('returns empty string for non-string input', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName(42)).toBe('');
  });
});

describe('matchesSupplier', () => {
  test('matches canonical name case-insensitively', () => {
    expect(matchesSupplier('AGRO INSUMOS SA', 'Agro Insumos SA')).toBe(true);
  });

  test('ignores diacritics on both sides', () => {
    expect(matchesSupplier('Químicos Pérez', 'Quimicos Perez')).toBe(true);
  });

  test('matches against aliases', () => {
    expect(matchesSupplier('ACME', 'Agro Insumos SA', ['Acme SA', 'ACME'])).toBe(true);
  });

  test('no match when unrelated', () => {
    expect(matchesSupplier('Otro Proveedor', 'Agro Insumos SA')).toBe(false);
  });

  test('empty candidate returns false', () => {
    expect(matchesSupplier('', 'Agro Insumos SA')).toBe(false);
    expect(matchesSupplier(null, 'Agro Insumos SA')).toBe(false);
  });
});
