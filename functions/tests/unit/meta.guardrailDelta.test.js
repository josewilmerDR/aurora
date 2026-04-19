// Unit tests for guardrailDelta — Fase 6.3.

const {
  proposeGuardrailDelta,
  aggregateTrustForGuardrail,
  effectiveTrust,
  interpolate,
  roundForUnit,
  classifyChange,
  SMALL_CHANGE_THRESHOLD,
} = require('../../lib/meta/trust/guardrailDelta');

const { CORRIDOR } = require('../../lib/meta/trust/corridor');

// Build a synthetic trustScores object with specific values per domain.
function trust({ finance, procurement, hr, strategy, meta } = {}) {
  const mk = (score, confidence = 1) => (score == null
    ? { score: null, confidence: 0, sampleSize: 0, effectiveSample: 0 }
    : { score, confidence, sampleSize: 100, effectiveSample: 100 });
  return {
    byDomain: {
      finance: mk(finance?.score, finance?.confidence ?? 1),
      procurement: mk(procurement?.score, procurement?.confidence ?? 1),
      hr: mk(hr?.score, hr?.confidence ?? 1),
      strategy: mk(strategy?.score, strategy?.confidence ?? 1),
      meta: mk(meta?.score, meta?.confidence ?? 1),
    },
    overall: { score: 0.5, confidence: 1 },
  };
}

describe('aggregateTrustForGuardrail', () => {
  const entry = { domains: ['finance', 'procurement'] };

  test('weights by confidence and averages', () => {
    const agg = aggregateTrustForGuardrail(entry, trust({
      finance: { score: 0.8, confidence: 1 },
      procurement: { score: 0.4, confidence: 0.5 },
    }));
    // sumWeighted = 0.8*1 + 0.4*0.5 = 1.0
    // sumWeight = 1 + 0.5 = 1.5
    // trust = 0.666...
    expect(agg.trust).toBeCloseTo(2 / 3, 3);
    expect(agg.contributingDomains).toBe(2);
  });

  test('null trust when all domains have no data', () => {
    const agg = aggregateTrustForGuardrail(entry, trust({}));
    expect(agg.trust).toBeNull();
    expect(agg.confidence).toBe(0);
  });

  test('ignores domains with zero confidence', () => {
    const agg = aggregateTrustForGuardrail(entry, trust({
      finance: { score: 0.9, confidence: 1 },
      procurement: { score: 0.0, confidence: 0 },
    }));
    expect(agg.trust).toBe(0.9);
    expect(agg.contributingDomains).toBe(1);
  });
});

describe('effectiveTrust (confidence shrinkage)', () => {
  test('confidence=1 returns trust unchanged', () => {
    expect(effectiveTrust(0.8, 1)).toBe(0.8);
    expect(effectiveTrust(0.2, 1)).toBe(0.2);
  });

  test('confidence=0 shrinks to 0.5 (no change)', () => {
    expect(effectiveTrust(0.9, 0)).toBe(0.5);
    expect(effectiveTrust(0.1, 0)).toBe(0.5);
  });

  test('partial confidence shrinks proportionally', () => {
    expect(effectiveTrust(1.0, 0.5)).toBe(0.75); // halfway between 0.5 and 1
    expect(effectiveTrust(0.0, 0.5)).toBe(0.25); // halfway between 0.5 and 0
  });

  test('null trust returns null', () => {
    expect(effectiveTrust(null, 1)).toBeNull();
  });
});

describe('interpolate (relax_is_higher)', () => {
  const entry = { floor: 1000, default: 5000, ceiling: 15000, direction: 'relax_is_higher' };

  test('t=1 → ceiling', () => {
    expect(interpolate(entry, 1)).toBe(15000);
  });

  test('t=0.5 → default', () => {
    expect(interpolate(entry, 0.5)).toBe(5000);
  });

  test('t=0 → floor', () => {
    expect(interpolate(entry, 0)).toBe(1000);
  });

  test('t=0.75 → midway between default and ceiling', () => {
    expect(interpolate(entry, 0.75)).toBe(10000); // default + (ceiling-default) * 0.5
  });

  test('null trust returns default', () => {
    expect(interpolate(entry, null)).toBe(5000);
  });
});

describe('roundForUnit', () => {
  test('percent rounds to integer', () => {
    expect(roundForUnit(88.7, { unit: 'percent' })).toBe(89);
  });

  test('count rounds to integer', () => {
    expect(roundForUnit(4.6, { unit: 'count' })).toBe(5);
  });

  test('USD ≥ 1000 rounds to 100', () => {
    expect(roundForUnit(5473, { unit: 'USD' })).toBe(5500);
  });

  test('USD < 1000 rounds to 10', () => {
    expect(roundForUnit(237, { unit: 'USD' })).toBe(240);
  });
});

describe('classifyChange', () => {
  test('relax_is_higher: higher is relax, lower is tighten', () => {
    const e = { direction: 'relax_is_higher' };
    expect(classifyChange(e, 5000, 7000)).toBe('relax');
    expect(classifyChange(e, 5000, 3000)).toBe('tighten');
    expect(classifyChange(e, 5000, 5000)).toBe('unchanged');
  });

  test('relax_is_lower: higher is tighten, lower is relax', () => {
    const e = { direction: 'relax_is_lower' };
    expect(classifyChange(e, 5000, 7000)).toBe('tighten');
    expect(classifyChange(e, 5000, 3000)).toBe('relax');
  });
});

describe('proposeGuardrailDelta', () => {
  test('high trust across relevant domains → relax', () => {
    const out = proposeGuardrailDelta({}, trust({
      finance: { score: 1, confidence: 1 },
      procurement: { score: 1, confidence: 1 },
      hr: { score: 1, confidence: 1 },
      strategy: { score: 1, confidence: 1 },
    }));
    expect(out.proposals.length).toBeGreaterThan(0);
    for (const p of out.proposals) {
      expect(p.direction).toBe('relax');
      expect(p.proposedValue).toBeGreaterThanOrEqual(p.corridor.default);
      expect(p.proposedValue).toBeLessThanOrEqual(p.corridor.ceiling);
    }
  });

  test('low trust across domains → tighten', () => {
    const out = proposeGuardrailDelta({}, trust({
      finance: { score: 0, confidence: 1 },
      procurement: { score: 0, confidence: 1 },
      hr: { score: 0, confidence: 1 },
      strategy: { score: 0, confidence: 1 },
    }));
    expect(out.proposals.length).toBeGreaterThan(0);
    for (const p of out.proposals) {
      expect(p.direction).toBe('tighten');
      expect(p.proposedValue).toBeGreaterThanOrEqual(p.corridor.floor);
      expect(p.proposedValue).toBeLessThanOrEqual(p.corridor.default);
    }
  });

  test('no proposals when all domains have null trust', () => {
    const out = proposeGuardrailDelta({}, trust({}));
    expect(out.proposals).toEqual([]);
    expect(out.summary.total).toBe(0);
  });

  test('low confidence shrinks proposed values toward default', () => {
    const high = proposeGuardrailDelta({}, trust({
      finance: { score: 1, confidence: 1 },
      procurement: { score: 1, confidence: 1 },
      hr: { score: 1, confidence: 1 },
      strategy: { score: 1, confidence: 1 },
    }));
    const low = proposeGuardrailDelta({}, trust({
      finance: { score: 1, confidence: 0.1 },
      procurement: { score: 1, confidence: 0.1 },
      hr: { score: 1, confidence: 0.1 },
      strategy: { score: 1, confidence: 0.1 },
    }));
    // With low confidence, proposed values should be closer to defaults
    // (possibly even no proposals if deltas are below the small-change
    // threshold — but at least ≤ the high-confidence delta).
    for (const p of low.proposals) {
      const match = high.proposals.find(h => h.key === p.key);
      if (match) {
        const defaultVal = CORRIDOR[p.key].default;
        expect(Math.abs(p.proposedValue - defaultVal)).toBeLessThanOrEqual(
          Math.abs(match.proposedValue - defaultVal)
        );
      }
    }
  });

  test('proposals always stay within corridor bounds', () => {
    for (const scoreValue of [0, 0.25, 0.5, 0.75, 1]) {
      const out = proposeGuardrailDelta({}, trust({
        finance: { score: scoreValue, confidence: 1 },
        procurement: { score: scoreValue, confidence: 1 },
        hr: { score: scoreValue, confidence: 1 },
        strategy: { score: scoreValue, confidence: 1 },
      }));
      for (const p of out.proposals) {
        expect(p.proposedValue).toBeGreaterThanOrEqual(p.corridor.floor);
        expect(p.proposedValue).toBeLessThanOrEqual(p.corridor.ceiling);
      }
    }
  });

  test('current value is read from config, falling back to default', () => {
    const out = proposeGuardrailDelta({ maxOrdenCompraMonto: 2500 }, trust({
      finance: { score: 1, confidence: 1 },
      procurement: { score: 1, confidence: 1 },
    }));
    const p = out.proposals.find(x => x.key === 'maxOrdenCompraMonto');
    if (p) expect(p.currentValue).toBe(2500);
  });

  test('skipKeys excludes those entries from proposal emission', () => {
    const out = proposeGuardrailDelta({}, trust({
      finance: { score: 1, confidence: 1 },
      procurement: { score: 1, confidence: 1 },
      hr: { score: 1, confidence: 1 },
      strategy: { score: 1, confidence: 1 },
    }), { skipKeys: ['maxOrdenCompraMonto'] });
    expect(out.proposals.find(p => p.key === 'maxOrdenCompraMonto')).toBeUndefined();
  });

  test('summary counts relax vs tighten correctly', () => {
    const out = proposeGuardrailDelta({}, trust({
      finance: { score: 0.9, confidence: 1 },
      procurement: { score: 0.9, confidence: 1 },
      hr: { score: 0.9, confidence: 1 },
      strategy: { score: 0.9, confidence: 1 },
    }));
    expect(out.summary.total).toBe(out.summary.relax + out.summary.tighten);
  });
});

describe('SMALL_CHANGE_THRESHOLD', () => {
  test('is a small positive fraction', () => {
    expect(SMALL_CHANGE_THRESHOLD).toBeGreaterThan(0);
    expect(SMALL_CHANGE_THRESHOLD).toBeLessThan(0.1);
  });
});
