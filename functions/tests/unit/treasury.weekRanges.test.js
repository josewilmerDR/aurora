// Unit tests for week range generator. Pure.

const { buildWeekRanges, isInWeek, parseISO, toISO, addDays } = require('../../lib/finance/weekRanges');

describe('parseISO', () => {
  test('valid dates', () => {
    const d = parseISO('2026-04-17');
    expect(d).not.toBeNull();
    expect(d.getUTCFullYear()).toBe(2026);
  });
  test('rejects invalid formats and fake dates', () => {
    expect(parseISO('2026-13-01')).toBeNull();
    expect(parseISO('2026-02-30')).toBeNull();
    expect(parseISO('17/04/2026')).toBeNull();
    expect(parseISO(null)).toBeNull();
  });
});

describe('buildWeekRanges', () => {
  test('first range starts at startDate when startDate is past Monday', () => {
    // 2026-04-17 is a Friday. Monday of that week is 2026-04-13.
    const ranges = buildWeekRanges('2026-04-17', 3);
    expect(ranges).toHaveLength(3);
    // First week: starts at Friday (startDate), ends at Sunday.
    expect(ranges[0].weekStart).toBe('2026-04-17');
    expect(ranges[0].weekEnd).toBe('2026-04-19');
    // Second week: full Mon–Sun.
    expect(ranges[1].weekStart).toBe('2026-04-20');
    expect(ranges[1].weekEnd).toBe('2026-04-26');
    expect(ranges[2].weekStart).toBe('2026-04-27');
    expect(ranges[2].weekEnd).toBe('2026-05-03');
  });

  test('first range is full when startDate is a Monday', () => {
    const ranges = buildWeekRanges('2026-04-20', 2); // Monday
    expect(ranges[0].weekStart).toBe('2026-04-20');
    expect(ranges[0].weekEnd).toBe('2026-04-26');
    expect(ranges[1].weekStart).toBe('2026-04-27');
  });

  test('Sunday start produces a single-day first bucket', () => {
    const ranges = buildWeekRanges('2026-04-19', 2); // Sunday
    expect(ranges[0].weekStart).toBe('2026-04-19');
    expect(ranges[0].weekEnd).toBe('2026-04-19');
    expect(ranges[1].weekStart).toBe('2026-04-20');
  });

  test('invalid inputs return empty array', () => {
    expect(buildWeekRanges('bad-date', 4)).toEqual([]);
    expect(buildWeekRanges('2026-04-17', 0)).toEqual([]);
    expect(buildWeekRanges('2026-04-17', -1)).toEqual([]);
  });
});

describe('isInWeek', () => {
  test('date inside inclusive range', () => {
    const range = { weekStart: '2026-04-20', weekEnd: '2026-04-26' };
    expect(isInWeek('2026-04-20', range)).toBe(true);
    expect(isInWeek('2026-04-23', range)).toBe(true);
    expect(isInWeek('2026-04-26', range)).toBe(true);
    expect(isInWeek('2026-04-19', range)).toBe(false);
    expect(isInWeek('2026-04-27', range)).toBe(false);
  });
});

describe('addDays / toISO', () => {
  test('addDays advances correctly across month boundaries', () => {
    const d = parseISO('2026-01-30');
    const out = addDays(d, 5);
    expect(toISO(out)).toBe('2026-02-04');
  });
});
