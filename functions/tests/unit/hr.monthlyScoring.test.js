// Unit tests for the hrMonthlyScoring cron helpers.
//
// The exported onSchedule is not directly tested here — it's a thin
// orchestrator over `computeFincaScores`. We verify the period
// derivation because it's easy to get wrong at year boundaries.

// The cron module pulls in `../lib/firebase` via its helpers; mock so
// tests don't need a Firestore connection.
jest.mock('../../lib/firebase', () => ({
  functions: { scheduler: { onSchedule: (_opts, _fn) => (() => {}) } },
  db: { collection: jest.fn() },
  Timestamp: { fromDate: () => ({}), now: () => ({}) },
  FieldValue: {},
}));

jest.mock('../../lib/hr/performanceAggregator', () => ({
  computeFincaScores: jest.fn(),
}));

const cronModule = require('../../scheduled/hrMonthlyScoring');
const { previousMonthPeriod } = cronModule;

describe('previousMonthPeriod', () => {
  test('middle of the year: May → 04', () => {
    expect(previousMonthPeriod(new Date(Date.UTC(2026, 4, 1)))).toBe('2026-04');
    expect(previousMonthPeriod(new Date(Date.UTC(2026, 4, 15)))).toBe('2026-04');
  });

  test('year boundary: January → December of previous year', () => {
    expect(previousMonthPeriod(new Date(Date.UTC(2026, 0, 1)))).toBe('2025-12');
    expect(previousMonthPeriod(new Date(Date.UTC(2026, 0, 28)))).toBe('2025-12');
  });

  test('pads single-digit months with leading zero', () => {
    expect(previousMonthPeriod(new Date(Date.UTC(2026, 1, 1)))).toBe('2026-01');
    expect(previousMonthPeriod(new Date(Date.UTC(2026, 9, 1)))).toBe('2026-09');
  });
});
