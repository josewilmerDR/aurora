// Unit tests for signalsIngestor pure helpers (isSourceDue, shouldDedup).
// La función `ingestSource` completa se cubre en el test de integración.

const { isSourceDue, shouldDedup } = require('../../lib/strategy/signalsIngestor');

describe('isSourceDue', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  test('returns true when source has never been fetched', () => {
    expect(isSourceDue({ ingestIntervalDays: 1 }, now)).toBe(true);
  });

  test('returns true when elapsed >= interval', () => {
    const lastFetchedAt = {
      toMillis: () => new Date('2024-06-14T11:00:00Z').getTime(),
    };
    expect(isSourceDue({ ingestIntervalDays: 1, lastFetchedAt }, now)).toBe(true);
  });

  test('returns false when elapsed < interval', () => {
    const lastFetchedAt = {
      toMillis: () => new Date('2024-06-15T10:00:00Z').getTime(),
    };
    expect(isSourceDue({ ingestIntervalDays: 1, lastFetchedAt }, now)).toBe(false);
  });

  test('defaults to daily interval when missing', () => {
    const lastFetchedAt = {
      toMillis: () => new Date('2024-06-13T12:00:00Z').getTime(),
    };
    expect(isSourceDue({ lastFetchedAt }, now)).toBe(true);
  });

  test('7-day interval respects its cadence', () => {
    const lastFetchedAt = {
      toMillis: () => new Date('2024-06-10T12:00:00Z').getTime(),
    };
    // 5 días → no debe.
    expect(isSourceDue({ ingestIntervalDays: 7, lastFetchedAt }, now)).toBe(false);
    // 8 días → sí debe.
    const eightDaysAgo = { toMillis: () => new Date('2024-06-07T11:00:00Z').getTime() };
    expect(isSourceDue({ ingestIntervalDays: 7, lastFetchedAt: eightDaysAgo }, now)).toBe(true);
  });

  test('falls back to lastSuccessfulFetchAt when lastFetchedAt missing', () => {
    const lastSuccessfulFetchAt = {
      toMillis: () => new Date('2024-06-15T10:00:00Z').getTime(),
    };
    expect(isSourceDue({ ingestIntervalDays: 1, lastSuccessfulFetchAt }, now)).toBe(false);
  });
});

describe('shouldDedup', () => {
  const nowMs = new Date('2024-06-15T12:00:00Z').getTime();

  test('dedupes when existing fetchedAt is within window', () => {
    const existing = { fetchedAt: { toMillis: () => nowMs - 30_000 } };
    expect(shouldDedup(existing, nowMs, 60_000)).toBe(true);
  });

  test('does NOT dedup when existing is outside window', () => {
    const existing = { fetchedAt: { toMillis: () => nowMs - 120_000 } };
    expect(shouldDedup(existing, nowMs, 60_000)).toBe(false);
  });

  test('null existing → no dedup', () => {
    expect(shouldDedup(null, nowMs, 60_000)).toBe(false);
  });
});
