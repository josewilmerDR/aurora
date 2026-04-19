// Unit tests for the pure helpers in the FincaState builder (Fase 6.0).
// Firestore-dependent `buildFincaState` is NOT covered here — that requires
// the emulator and is covered by an integration test.

const {
  _internals: {
    currentMonthPeriod,
    previousMonthPeriod,
    addDaysISO,
    summarizeExecution,
    avgScore,
    fpOf,
    fpList,
    fpProjectionEvents,
    computeInputsHash,
    DEFAULT_HORIZON_WEEKS,
    DEFAULT_LOOKBACK_WEEKS,
    HR_WORKLOAD_HORIZON_WEEKS,
    RECENT_SIGNALS_LIMIT,
  },
} = require('../../lib/meta/fincaStateBuilder');

describe('currentMonthPeriod', () => {
  test('returns YYYY-MM from a given date', () => {
    expect(currentMonthPeriod(new Date(Date.UTC(2026, 3, 18)))).toBe('2026-04');
    expect(currentMonthPeriod(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01');
    expect(currentMonthPeriod(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-12');
  });

  test('pads single-digit months', () => {
    expect(currentMonthPeriod(new Date(Date.UTC(2026, 2, 5)))).toBe('2026-03');
  });
});

describe('previousMonthPeriod', () => {
  test('subtracts one month within the same year', () => {
    expect(previousMonthPeriod('2026-04')).toBe('2026-03');
    expect(previousMonthPeriod('2026-12')).toBe('2026-11');
  });

  test('rolls back across January', () => {
    expect(previousMonthPeriod('2026-01')).toBe('2025-12');
  });
});

describe('addDaysISO', () => {
  test('adds days within a month', () => {
    expect(addDaysISO('2026-04-18', 7)).toBe('2026-04-25');
  });

  test('rolls forward across month boundary', () => {
    expect(addDaysISO('2026-04-28', 5)).toBe('2026-05-03');
  });

  test('rolls forward across year boundary', () => {
    expect(addDaysISO('2026-12-30', 5)).toBe('2027-01-04');
  });

  test('returns original string when input is invalid', () => {
    expect(addDaysISO('not-a-date', 1)).toBe('not-a-date');
  });
});

describe('summarizeExecution', () => {
  test('rolls up totals and counts over-budget rows', () => {
    const rows = [
      { assignedAmount: 1000, executedAmount: 500, overBudget: false },
      { assignedAmount: 2000, executedAmount: 2500, overBudget: true },
      { assignedAmount: 500, executedAmount: 0, overBudget: false },
    ];
    expect(summarizeExecution(rows)).toEqual({
      overBudgetCount: 1,
      totalAssigned: 3500,
      totalExecuted: 3000,
      overallPercent: 85.71,
    });
  });

  test('overallPercent is null when nothing is assigned', () => {
    const rows = [
      { assignedAmount: 0, executedAmount: 50, overBudget: false },
    ];
    const s = summarizeExecution(rows);
    expect(s.totalAssigned).toBe(0);
    expect(s.totalExecuted).toBe(50);
    expect(s.overallPercent).toBeNull();
  });

  test('empty input produces zero totals', () => {
    expect(summarizeExecution([])).toEqual({
      overBudgetCount: 0,
      totalAssigned: 0,
      totalExecuted: 0,
      overallPercent: null,
    });
  });
});

describe('avgScore', () => {
  test('averages numeric scores rounded to 2 decimals', () => {
    expect(avgScore([{ score: 80 }, { score: 90 }, { score: 85 }])).toBe(85);
    expect(avgScore([{ score: 70 }, { score: 73 }])).toBe(71.5);
  });

  test('null when no valid scores', () => {
    expect(avgScore([])).toBeNull();
    expect(avgScore([{ score: 'abc' }])).toBeNull();
    expect(avgScore([{ score: null }])).toBeNull();
  });

  test('ignores non-numeric scores in the average', () => {
    expect(avgScore([{ score: 80 }, { score: 'x' }, { score: 90 }])).toBe(85);
  });
});

describe('fpOf', () => {
  test('uses updatedAt ms when available', () => {
    const doc = { id: 'a', updatedAt: { toMillis: () => 1700000000000 } };
    expect(fpOf(doc)).toBe('a:1700000000000');
  });

  test('falls back to createdAt when updatedAt missing', () => {
    const doc = { id: 'a', createdAt: { toMillis: () => 1600000000000 } };
    expect(fpOf(doc)).toBe('a:1600000000000');
  });

  test('falls back to :0 when no timestamps', () => {
    expect(fpOf({ id: 'a' })).toBe('a:0');
  });

  test('empty string for missing id', () => {
    expect(fpOf(null)).toBe('');
    expect(fpOf({})).toBe('');
  });
});

describe('fpList', () => {
  test('sorts fingerprints for order-independent hashing', () => {
    const a = fpList([{ id: 'b' }, { id: 'a' }, { id: 'c' }]);
    const b = fpList([{ id: 'c' }, { id: 'a' }, { id: 'b' }]);
    expect(a).toEqual(b);
  });

  test('filters out entries without id', () => {
    expect(fpList([{ id: 'a' }, {}, null, { id: 'b' }])).toEqual(['a:0', 'b:0']);
  });

  test('handles null/undefined input as empty', () => {
    expect(fpList(null)).toEqual([]);
    expect(fpList(undefined)).toEqual([]);
  });
});

describe('fpProjectionEvents', () => {
  test('normalizes and sorts events for order-independent hashing', () => {
    const a = fpProjectionEvents([
      { source: 'ordenes_compra', date: '2026-05-01', type: 'outflow', amount: 100, label: 'OC-1' },
      { source: 'income_records', date: '2026-04-25', type: 'inflow', amount: 500, label: 'I-1' },
    ]);
    const b = fpProjectionEvents([
      { source: 'income_records', date: '2026-04-25', type: 'inflow', amount: 500, label: 'I-1' },
      { source: 'ordenes_compra', date: '2026-05-01', type: 'outflow', amount: 100, label: 'OC-1' },
    ]);
    expect(a).toEqual(b);
    expect(a[0].date).toBe('2026-04-25'); // earlier date first
  });

  test('rounds amounts to cents', () => {
    const out = fpProjectionEvents([
      { source: 's', date: '2026-04-25', type: 'inflow', amount: 100.12345, label: 'l' },
    ]);
    expect(out[0].amount).toBe(100.12);
  });

  test('missing fields default to empty strings / zero', () => {
    const out = fpProjectionEvents([{}]);
    expect(out).toEqual([{ source: '', date: '', type: '', amount: 0, label: '' }]);
  });

  test('null input returns empty array', () => {
    expect(fpProjectionEvents(null)).toEqual([]);
  });
});

describe('computeInputsHash', () => {
  function base() {
    return {
      asOf: '2026-04-18',
      period: '2026-04',
      horizonWeeks: 4,
      lookbackWeeks: 8,
      budgets: [{ id: 'b1' }],
      productos: [{ id: 'p1' }, { id: 'p2' }],
      movimientos: [{ id: 'm1' }],
      siembras: [{ id: 's1' }],
      packages: [{ id: 'pk1' }],
      fichas: [{ id: 'f1' }],
      scoresCurrent: [{ id: 'sc1' }],
      scoresPrev: [{ id: 'sp1' }],
      cashBalance: { id: 'cb1', updatedAt: { toMillis: () => 1000 } },
      activeAnnualPlan: { id: 'ap1', updatedAt: { toMillis: () => 2000 } },
      recentSignals: [{ id: 'sig1' }],
      lastDebtSimulation: { id: 'ds1', updatedAt: { toMillis: () => 3000 } },
      projectionEvents: [
        { source: 'ordenes_compra', date: '2026-04-25', type: 'outflow', amount: 100, label: 'OC-1' },
      ],
    };
  }

  test('same inputs → same hash', () => {
    expect(computeInputsHash(base())).toBe(computeInputsHash(base()));
  });

  test('doc order within collections does not affect hash', () => {
    const a = base();
    const b = base();
    b.productos = [{ id: 'p2' }, { id: 'p1' }];
    expect(computeInputsHash(a)).toBe(computeInputsHash(b));
  });

  test('projection event order does not affect hash', () => {
    const a = base();
    const b = base();
    b.projectionEvents = [
      { source: 'income_records', date: '2026-04-20', type: 'inflow', amount: 50, label: 'X' },
      { source: 'ordenes_compra', date: '2026-04-25', type: 'outflow', amount: 100, label: 'OC-1' },
    ];
    a.projectionEvents = [
      { source: 'ordenes_compra', date: '2026-04-25', type: 'outflow', amount: 100, label: 'OC-1' },
      { source: 'income_records', date: '2026-04-20', type: 'inflow', amount: 50, label: 'X' },
    ];
    expect(computeInputsHash(a)).toBe(computeInputsHash(b));
  });

  test('added doc changes hash', () => {
    const a = base();
    const b = base();
    b.productos = [...b.productos, { id: 'p3' }];
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  test('mutation of updatedAt changes hash', () => {
    const a = base();
    const b = base();
    b.cashBalance = { id: 'cb1', updatedAt: { toMillis: () => 9999 } };
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  test('added projection event changes hash', () => {
    const a = base();
    const b = base();
    b.projectionEvents = [
      ...a.projectionEvents,
      { source: 'income_records', date: '2026-05-01', type: 'inflow', amount: 200, label: 'Y' },
    ];
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  test('different asOf → different hash', () => {
    const a = base();
    const b = { ...base(), asOf: '2026-04-19' };
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  test('different period → different hash', () => {
    const a = base();
    const b = { ...base(), period: '2026-05' };
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  test('different horizonWeeks → different hash', () => {
    const a = base();
    const b = { ...base(), horizonWeeks: 8 };
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  test('missing-vs-present optional doc changes hash', () => {
    const a = base();
    const b = { ...base(), activeAnnualPlan: null };
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  test('hash is sha256:<64 hex chars>', () => {
    expect(computeInputsHash(base())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('constants', () => {
  test('defaults are within documented bounds', () => {
    expect(DEFAULT_HORIZON_WEEKS).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_HORIZON_WEEKS).toBeLessThanOrEqual(26);
    expect(DEFAULT_LOOKBACK_WEEKS).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_LOOKBACK_WEEKS).toBeLessThanOrEqual(52);
    expect(HR_WORKLOAD_HORIZON_WEEKS).toBeGreaterThan(0);
    expect(RECENT_SIGNALS_LIMIT).toBeGreaterThan(0);
  });
});
