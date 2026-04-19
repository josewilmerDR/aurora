// Unit tests for trustManager — Fase 6.3.
// Mocks Firestore writes; validates routing policy (N1/N2/N3) + pure helpers.

const { shouldAutoApply, buildActionParams, buildTitle } = require('../../lib/meta/trust/trustManager');

describe('shouldAutoApply', () => {
  test('N1 never auto-applies', () => {
    expect(shouldAutoApply({ direction: 'relax' }, 'nivel1')).toBe(false);
    expect(shouldAutoApply({ direction: 'tighten' }, 'nivel1')).toBe(false);
    expect(shouldAutoApply({ direction: 'relax' }, 'off')).toBe(false);
  });

  test('N2 auto-applies tightening only', () => {
    expect(shouldAutoApply({ direction: 'tighten' }, 'nivel2')).toBe(true);
    expect(shouldAutoApply({ direction: 'relax' }, 'nivel2')).toBe(false);
  });

  test('N3 auto-applies both directions', () => {
    expect(shouldAutoApply({ direction: 'tighten' }, 'nivel3')).toBe(true);
    expect(shouldAutoApply({ direction: 'relax' }, 'nivel3')).toBe(true);
  });

  test('unknown direction at any level is not auto-applied', () => {
    expect(shouldAutoApply({ direction: 'unchanged' }, 'nivel3')).toBe(false);
  });
});

describe('buildActionParams', () => {
  test('forwards the relevant fields without mutating the proposal', () => {
    const p = {
      key: 'maxOrdenCompraMonto',
      currentValue: 5000,
      proposedValue: 7000,
      direction: 'relax',
      trustInput: { trust: 0.8, confidence: 0.9, contributingDomains: 2, effectiveTrust: 0.77 },
      corridor: { floor: 1000, default: 5000, ceiling: 15000 },
      unit: 'USD',
      domains: ['finance', 'procurement'],
    };
    const out = buildActionParams(p);
    expect(out).toEqual({
      key: 'maxOrdenCompraMonto',
      newValue: 7000,
      previousValue: 5000,
      direction: 'relax',
      trustInput: p.trustInput,
      corridor: p.corridor,
      unit: 'USD',
      domains: ['finance', 'procurement'],
    });
    // Proposal unchanged
    expect(p.currentValue).toBe(5000);
  });
});

describe('buildTitle', () => {
  test('relax direction', () => {
    expect(buildTitle({ direction: 'relax', key: 'k', currentValue: 1, proposedValue: 2 }))
      .toBe('Relajar k (1 → 2)');
  });

  test('tighten direction', () => {
    expect(buildTitle({ direction: 'tighten', key: 'k', currentValue: 5, proposedValue: 3 }))
      .toBe('Endurecer k (5 → 3)');
  });
});
