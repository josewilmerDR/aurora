// Unit tests for the orchestrator's pure helpers: month math, latest cash
// selection, and the inputs hash. Firestore-dependent `buildFinancialProfile`
// is covered by the integration test, not here.

const {
  _internals: { addMonthsISO, deriveRanges, latestCashBalance, computeInputsHash, fpOf },
} = require('../../lib/financing/financialProfileBuilder');

describe('addMonthsISO', () => {
  test('subtracts months', () => {
    expect(addMonthsISO('2026-04-18', -12)).toBe('2025-04-18');
    expect(addMonthsISO('2026-04-18', -3)).toBe('2026-01-18');
  });

  test('adds months', () => {
    expect(addMonthsISO('2026-04-18', 6)).toBe('2026-10-18');
    expect(addMonthsISO('2026-11-20', 3)).toBe('2027-02-20');
  });

  test('clamps day-of-month when target month is shorter', () => {
    expect(addMonthsISO('2026-03-31', -1)).toBe('2026-02-28'); // Feb 2026 = 28 days
    expect(addMonthsISO('2024-03-31', -1)).toBe('2024-02-29'); // 2024 leap year
  });
});

describe('deriveRanges', () => {
  test('history = [asOf-12m, asOf]; projection starts day after asOf', () => {
    const ranges = deriveRanges('2026-04-18');
    expect(ranges.historyRange).toEqual({ from: '2025-04-18', to: '2026-04-18' });
    expect(ranges.projectionRange).toEqual({ from: '2026-04-19', to: '2026-10-18' });
  });

  test('history and projection do not overlap', () => {
    const { historyRange, projectionRange } = deriveRanges('2026-04-18');
    expect(historyRange.to < projectionRange.from).toBe(true);
  });
});

describe('latestCashBalance', () => {
  test('picks the record with highest dateAsOf ≤ asOf', () => {
    const all = [
      { id: 'c1', dateAsOf: '2026-01-01', amount: 100 },
      { id: 'c2', dateAsOf: '2026-03-01', amount: 500 },
      { id: 'c3', dateAsOf: '2026-05-01', amount: 999 }, // after asOf → excluded
    ];
    expect(latestCashBalance(all, '2026-04-01').id).toBe('c2');
  });

  test('returns null if no eligible record', () => {
    expect(latestCashBalance([], '2026-04-01')).toBeNull();
    expect(latestCashBalance([{ id: 'c1', dateAsOf: '2027-01-01' }], '2026-04-01')).toBeNull();
  });

  test('ignores records without dateAsOf', () => {
    const all = [{ id: 'c1', amount: 500 }];
    expect(latestCashBalance(all, '2026-04-01')).toBeNull();
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

  test('empty for missing id', () => {
    expect(fpOf(null)).toBe('');
    expect(fpOf({})).toBe('');
  });
});

describe('computeInputsHash', () => {
  function base() {
    return {
      asOf: '2026-04-18',
      historyRange: { from: '2025-04-18', to: '2026-04-18' },
      projectionRange: { from: '2026-04-18', to: '2026-10-18' },
      cashBalance: { id: 'c1', updatedAt: { toMillis: () => 1000 } },
      incomeRecords: [{ id: 'i1' }, { id: 'i2' }],
      productos: [{ id: 'p1' }],
      maquinaria: [],
      horimetro: [],
      ordenesCompra: [],
      planillaUnidad: [],
      planillaFija: [],
      cedulas: [],
      costosIndirectos: [],
    };
  }

  test('same inputs → same hash', () => {
    expect(computeInputsHash(base())).toBe(computeInputsHash(base()));
  });

  test('order of docs does not affect hash', () => {
    const a = base();
    const b = base();
    b.incomeRecords = [{ id: 'i2' }, { id: 'i1' }];
    expect(computeInputsHash(a)).toBe(computeInputsHash(b));
  });

  test('added doc changes hash', () => {
    const a = base();
    const b = base();
    b.incomeRecords.push({ id: 'i3' });
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  test('mutation (updatedAt change) changes hash', () => {
    const a = base();
    const b = base();
    b.incomeRecords[0] = { id: 'i1', updatedAt: { toMillis: () => 2000 } };
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  test('different asOf → different hash', () => {
    const a = base();
    const b = { ...base(), asOf: '2026-04-19' };
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  test('hash is sha256:<64 hex chars>', () => {
    expect(computeInputsHash(base())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
