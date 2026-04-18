// Unit tests for finance analyzer heuristics. Pure.

const { findReallocationCandidates, DEFAULTS } = require('../../lib/finance/financeAnalyzerHeuristics');

const row = (category, assigned, executed) => {
  const pct = assigned > 0 ? (executed / assigned) * 100 : null;
  return { category, assignedAmount: assigned, executedAmount: executed, percentConsumed: pct };
};

const bmap = (cats) => {
  const out = {};
  for (const c of cats) out[c] = [{ id: `b-${c}`, category: c }];
  return out;
};

describe('findReallocationCandidates', () => {
  test('pairs an over-budget category with an under-budget one', () => {
    const rows = [
      row('combustible', 1000, 1100), // 110% — over
      row('insumos',     1000, 200),  // 20%  — under
    ];
    const out = findReallocationCandidates(rows, bmap(['combustible', 'insumos']));
    expect(out).toHaveLength(1);
    expect(out[0].fromCategory).toBe('insumos');
    expect(out[0].toCategory).toBe('combustible');
    // Shortfall = 100, slack = 1000 - 200 - 50 (buffer) = 750 → amount = min(100, 750) = 100
    expect(out[0].amount).toBe(100);
    expect(out[0].reason).toMatch(/combustible/);
    expect(out[0].reason).toMatch(/insumos/);
  });

  test('returns empty when no category is over-budget', () => {
    const rows = [
      row('combustible', 1000, 500),
      row('insumos',     1000, 300),
    ];
    expect(findReallocationCandidates(rows, bmap(['combustible', 'insumos']))).toEqual([]);
  });

  test('returns empty when over-budget exists but no under-budget', () => {
    const rows = [
      row('combustible', 1000, 1200), // over
      row('insumos',     1000, 900),  // 90%, not under
    ];
    expect(findReallocationCandidates(rows, bmap(['combustible', 'insumos']))).toEqual([]);
  });

  test('skips categories without a budget doc in the map', () => {
    const rows = [
      row('combustible', 1000, 1200), // over
      row('insumos',     1000, 200),  // under — but no budget doc!
    ];
    expect(findReallocationCandidates(rows, bmap(['combustible']))).toEqual([]);
  });

  test('uses one source per over-budget (no canibalización)', () => {
    const rows = [
      row('combustible', 1000, 1500),    // over, shortfall 500
      row('insumos',     1000, 1300),    // over, shortfall 300
      row('administrativo', 2000, 200),  // under, slack 1750
    ];
    const out = findReallocationCandidates(rows, bmap(['combustible', 'insumos', 'administrativo']));
    // El primer over-budget consume el único under disponible.
    expect(out).toHaveLength(1);
    expect(out[0].toCategory).toBe('combustible'); // el más crítico primero
    expect(out[0].fromCategory).toBe('administrativo');
  });

  test('does not propose transfers below minTransferAmount', () => {
    const rows = [
      row('combustible', 1000, 1050), // shortfall 50 < default min (100)
      row('insumos',     1000, 100),
    ];
    expect(findReallocationCandidates(rows, bmap(['combustible', 'insumos']))).toEqual([]);
  });

  test('custom thresholds override defaults', () => {
    const rows = [
      row('combustible', 1000, 1050),
      row('insumos',     1000, 100),
    ];
    // Con minTransferAmount=10, el shortfall de 50 sí califica.
    const out = findReallocationCandidates(
      rows,
      bmap(['combustible', 'insumos']),
      { minTransferAmount: 10 }
    );
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(50);
  });

  test('respects minSourceBufferAfter', () => {
    const rows = [
      row('combustible', 1000, 1100),  // shortfall 100
      row('insumos',     300, 100),    // slack = 300-100-50 = 150 (default buffer)
    ];
    const out = findReallocationCandidates(rows, bmap(['combustible', 'insumos']));
    expect(out[0].amount).toBe(100); // min(100, 150)
  });

  test('ignores rows with no budget assigned', () => {
    const rows = [
      row('combustible', 0, 500),      // sin budget
      row('insumos',     1000, 100),   // under
    ];
    expect(findReallocationCandidates(rows, bmap(['combustible', 'insumos']))).toEqual([]);
  });

  test('invalid input returns empty array', () => {
    expect(findReallocationCandidates(null, {})).toEqual([]);
    expect(findReallocationCandidates(undefined, {})).toEqual([]);
    expect(findReallocationCandidates('not-an-array', {})).toEqual([]);
  });

  test('DEFAULTS is frozen', () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
  });
});
