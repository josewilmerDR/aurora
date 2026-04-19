// Unit tests for the seeded PRNG. Determinism is essential for Monte Carlo
// reproducibility.

const { createPrng } = require('../../lib/strategy/prng');

describe('createPrng — determinism', () => {
  test('same seed produces same uniform sequence', () => {
    const a = createPrng(42);
    const b = createPrng(42);
    const seqA = Array.from({ length: 20 }, () => a.nextUniform());
    const seqB = Array.from({ length: 20 }, () => b.nextUniform());
    expect(seqA).toEqual(seqB);
  });

  test('different seeds produce different sequences', () => {
    const a = createPrng(1);
    const b = createPrng(2);
    const seqA = Array.from({ length: 10 }, () => a.nextUniform());
    const seqB = Array.from({ length: 10 }, () => b.nextUniform());
    expect(seqA).not.toEqual(seqB);
  });

  test('same seed produces same normal sequence', () => {
    const a = createPrng(7);
    const b = createPrng(7);
    const seqA = Array.from({ length: 20 }, () => a.nextNormal());
    const seqB = Array.from({ length: 20 }, () => b.nextNormal());
    expect(seqA).toEqual(seqB);
  });
});

describe('nextUniform range', () => {
  test('values are in [0, 1)', () => {
    const p = createPrng(123);
    for (let i = 0; i < 1000; i++) {
      const v = p.nextUniform();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('nextNormal distribution', () => {
  test('mean is close to 0 and stddev close to 1 for large N', () => {
    const p = createPrng(99);
    const n = 10_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = p.nextNormal();
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    const stddev = Math.sqrt(variance);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(stddev - 1)).toBeLessThan(0.05);
  });
});

describe('nextNormalScaled', () => {
  test('mean/stddev reflect μ and σ', () => {
    const p = createPrng(7);
    const n = 5000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = p.nextNormalScaled(10, 2);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const stddev = Math.sqrt(sumSq / n - mean * mean);
    expect(Math.abs(mean - 10)).toBeLessThan(0.2);
    expect(Math.abs(stddev - 2)).toBeLessThan(0.15);
  });
});

describe('seed edge cases', () => {
  test('seed 0 normalizes to a non-zero state', () => {
    const p = createPrng(0);
    const seq = Array.from({ length: 5 }, () => p.nextUniform());
    // No asserción de valores — solo que no explote y produzca valores válidos.
    expect(seq.every(v => v >= 0 && v < 1)).toBe(true);
  });
});
