// Unit tests for period string → date range. Pure — no Firestore.

const { periodToDateRange, isValidPeriod } = require('../../lib/finance/periodRange');

describe('periodToDateRange', () => {
  test('year period', () => {
    expect(periodToDateRange('2026')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  test('month period — January', () => {
    expect(periodToDateRange('2026-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  test('month period — February non-leap year', () => {
    expect(periodToDateRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  test('month period — February leap year', () => {
    expect(periodToDateRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  test('month period — April (30 days)', () => {
    expect(periodToDateRange('2026-04')).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });

  test('quarter Q1', () => {
    expect(periodToDateRange('2026-Q1')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });

  test('quarter Q2', () => {
    expect(periodToDateRange('2026-Q2')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  test('quarter Q3', () => {
    expect(periodToDateRange('2026-Q3')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });

  test('quarter Q4', () => {
    expect(periodToDateRange('2026-Q4')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });

  test('invalid formats return null', () => {
    expect(periodToDateRange('2026-13')).toBeNull();     // mes 13
    expect(periodToDateRange('2026-Q5')).toBeNull();     // trimestre inválido
    expect(periodToDateRange('26-01')).toBeNull();       // año corto
    expect(periodToDateRange('2026/04')).toBeNull();     // formato incorrecto
    expect(periodToDateRange('2026-4')).toBeNull();      // mes sin padding
    expect(periodToDateRange('')).toBeNull();
    expect(periodToDateRange(null)).toBeNull();
    expect(periodToDateRange(undefined)).toBeNull();
    expect(periodToDateRange(42)).toBeNull();
  });
});

describe('isValidPeriod', () => {
  test('delegates to periodToDateRange', () => {
    expect(isValidPeriod('2026-04')).toBe(true);
    expect(isValidPeriod('2026-Q2')).toBe(true);
    expect(isValidPeriod('2026')).toBe(true);
    expect(isValidPeriod('invalid')).toBe(false);
  });
});
