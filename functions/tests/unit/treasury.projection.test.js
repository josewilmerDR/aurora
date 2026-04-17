// Unit tests for weekly cash projection. Pure.

const { buildWeeklyProjection } = require('../../lib/finance/projection');

function inflow(date, amount, label = 'x') {
  return { date, amount, type: 'inflow', source: 'test', label };
}
function outflow(date, amount, label = 'x') {
  return { date, amount, type: 'outflow', source: 'test', label };
}

describe('buildWeeklyProjection', () => {
  test('empty events → flat balance across horizon', () => {
    const out = buildWeeklyProjection({
      startingBalance: 1000,
      startingDate: '2026-04-20', // Monday
      events: [],
      weeks: 3,
    });
    expect(out.series).toHaveLength(3);
    expect(out.series.every(w => w.closingBalance === 1000)).toBe(true);
    expect(out.summary.endingBalance).toBe(1000);
    expect(out.summary.minBalance).toBe(1000);
    expect(out.summary.negativeWeeks).toBe(0);
  });

  test('inflow bumps closing balance in its week only', () => {
    const out = buildWeeklyProjection({
      startingBalance: 500,
      startingDate: '2026-04-20',
      events: [inflow('2026-04-23', 300, 'cobro')],
      weeks: 3,
    });
    expect(out.series[0].inflows).toHaveLength(1);
    expect(out.series[0].closingBalance).toBe(800);
    expect(out.series[1].closingBalance).toBe(800); // running
    expect(out.series[2].closingBalance).toBe(800);
    expect(out.summary.totalInflows).toBe(300);
  });

  test('outflow reduces running balance', () => {
    const out = buildWeeklyProjection({
      startingBalance: 1000,
      startingDate: '2026-04-20',
      events: [outflow('2026-04-25', 400, 'OC-1')],
      weeks: 2,
    });
    expect(out.series[0].netFlow).toBe(-400);
    expect(out.series[0].closingBalance).toBe(600);
    expect(out.summary.totalOutflows).toBe(400);
  });

  test('detects negative weeks and min balance', () => {
    const out = buildWeeklyProjection({
      startingBalance: 100,
      startingDate: '2026-04-20',
      events: [
        outflow('2026-04-22', 500, 'OC-big'),
        inflow('2026-05-05', 600, 'cobro'),
      ],
      weeks: 4,
    });
    // Week 1: net -500 → closing -400 (negative)
    expect(out.series[0].closingBalance).toBe(-400);
    // Week 2 (starts 2026-04-27): no flow, stays -400
    expect(out.series[1].closingBalance).toBe(-400);
    // Week 3 (starts 2026-05-04): +600 inflow → 200
    expect(out.series[2].closingBalance).toBe(200);
    expect(out.summary.minBalance).toBe(-400);
    expect(out.summary.negativeWeeks).toBe(2);
  });

  test('events outside horizon are ignored', () => {
    const out = buildWeeklyProjection({
      startingBalance: 100,
      startingDate: '2026-04-20',
      events: [
        inflow('2027-01-01', 9999, 'far future'),
        outflow('2025-01-01', 9999, 'past'),
      ],
      weeks: 2,
    });
    expect(out.summary.totalInflows).toBe(0);
    expect(out.summary.totalOutflows).toBe(0);
    expect(out.summary.endingBalance).toBe(100);
  });

  test('zero weeks → empty series', () => {
    const out = buildWeeklyProjection({
      startingBalance: 100,
      startingDate: '2026-04-20',
      events: [],
      weeks: 0,
    });
    expect(out.series).toEqual([]);
    expect(out.summary.endingBalance).toBe(100);
  });

  test('rounds to 2 decimals', () => {
    const out = buildWeeklyProjection({
      startingBalance: 100,
      startingDate: '2026-04-20',
      events: [inflow('2026-04-22', 33.333, 'x')],
      weeks: 1,
    });
    expect(out.series[0].closingBalance).toBe(133.33);
    expect(out.summary.totalInflows).toBe(33.33);
  });

  test('events within same week are sorted by date', () => {
    const out = buildWeeklyProjection({
      startingBalance: 0,
      startingDate: '2026-04-20',
      events: [
        inflow('2026-04-24', 200, 'Friday'),
        inflow('2026-04-21', 100, 'Tuesday'),
      ],
      weeks: 1,
    });
    expect(out.series[0].inflows.map(e => e.date)).toEqual([
      '2026-04-21', '2026-04-24',
    ]);
  });
});
