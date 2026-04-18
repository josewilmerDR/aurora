// Unit tests for performanceAlertDetector. Pure.

const {
  detectAlerts,
  percentile,
  computePeriodCutoffs,
  consecutiveRunBelow,
  indexScores,
  DEFAULT_OPTS,
} = require('../../lib/hr/performanceAlertDetector');

function scoreFor(userId, score, { lowConfidence = false } = {}) {
  return { userId, score, lowConfidence, sampleSize: 10 };
}

// Builds a 5-worker peer context where u1 is consistently low.
function peersWith(lowWorkerScore, lowWorkerId = 'u1', opts = {}) {
  return [
    scoreFor(lowWorkerId, lowWorkerScore, opts),
    scoreFor('u2', 70),
    scoreFor('u3', 75),
    scoreFor('u4', 80),
    scoreFor('u5', 85),
  ];
}

// ── Guards ──────────────────────────────────────────────────────────────

describe('detectAlerts — guards', () => {
  test('missing currentPeriod returns empty', () => {
    expect(detectAlerts({ periodChain: ['2026-04'], scoresByPeriod: {} }).alerts).toEqual([]);
  });

  test('missing periodChain returns empty', () => {
    expect(detectAlerts({ currentPeriod: '2026-04' }).alerts).toEqual([]);
  });

  test('periodChain must lead with currentPeriod', () => {
    const out = detectAlerts({
      currentPeriod: '2026-04',
      periodChain: ['2026-03', '2026-04'],
      scoresByPeriod: {},
    });
    expect(out.alerts).toEqual([]);
    expect(out.reason).toMatch(/lead[_ ]with[_ ]currentPeriod/);
  });
});

// ── Percentile plumbing ────────────────────────────────────────────────

describe('percentile + cutoffs', () => {
  test('cutoffs null when fewer than 3 reliable scores', () => {
    const out = computePeriodCutoffs([scoreFor('u1', 70), scoreFor('u2', 60)], DEFAULT_OPTS);
    expect(out.p25).toBeNull();
    expect(out.p10).toBeNull();
  });

  test('lowConfidence workers excluded from percentile base', () => {
    const scores = [
      scoreFor('noise', 5, { lowConfidence: true }), // would drag p25 down
      scoreFor('u1', 70),
      scoreFor('u2', 72),
      scoreFor('u3', 78),
      scoreFor('u4', 85),
    ];
    const out = computePeriodCutoffs(scores, DEFAULT_OPTS);
    expect(out.reliableCount).toBe(4);
    expect(out.p25).toBeGreaterThan(65); // noisy 5 is ignored
  });

  test('percentile textbook: [1..9] p50=5, p25=3, p75=7', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 25)).toBe(3);
    expect(percentile(sorted, 75)).toBe(7);
  });
});

// ── Consecutive run logic ─────────────────────────────────────────────

describe('consecutiveRunBelow', () => {
  test('returns N when worker is below cutoff for N consecutive months', () => {
    const scoresByPeriod = {
      '2026-04': [scoreFor('u1', 50)],
      '2026-03': [scoreFor('u1', 52)],
      '2026-02': [scoreFor('u1', 54)],
    };
    const cutoffs = new Map([
      ['2026-04', { p25: 65 }],
      ['2026-03', { p25: 65 }],
      ['2026-02', { p25: 65 }],
    ]);
    const run = consecutiveRunBelow({
      userId: 'u1',
      periodChain: ['2026-04', '2026-03', '2026-02'],
      scoreIndex: indexScores(scoresByPeriod),
      cutoffs,
      threshold: 'p25',
    });
    expect(run).toBe(3);
  });

  test('breaks as soon as worker is at/above cutoff', () => {
    const scoresByPeriod = {
      '2026-04': [scoreFor('u1', 50)],
      '2026-03': [scoreFor('u1', 70)], // above cutoff → breaks run
      '2026-02': [scoreFor('u1', 50)],
    };
    const cutoffs = new Map([
      ['2026-04', { p25: 65 }],
      ['2026-03', { p25: 65 }],
      ['2026-02', { p25: 65 }],
    ]);
    const run = consecutiveRunBelow({
      userId: 'u1',
      periodChain: ['2026-04', '2026-03', '2026-02'],
      scoreIndex: indexScores(scoresByPeriod),
      cutoffs,
      threshold: 'p25',
    });
    expect(run).toBe(1);
  });

  test('lowConfidence in any month breaks the run', () => {
    const scoresByPeriod = {
      '2026-04': [scoreFor('u1', 50)],
      '2026-03': [scoreFor('u1', 50, { lowConfidence: true })],
      '2026-02': [scoreFor('u1', 50)],
    };
    const cutoffs = new Map([
      ['2026-04', { p25: 65 }],
      ['2026-03', { p25: 65 }],
      ['2026-02', { p25: 65 }],
    ]);
    const run = consecutiveRunBelow({
      userId: 'u1',
      periodChain: ['2026-04', '2026-03', '2026-02'],
      scoreIndex: indexScores(scoresByPeriod),
      cutoffs,
      threshold: 'p25',
    });
    expect(run).toBe(1);
  });

  test('missing cutoff for older period caps the run length', () => {
    const scoresByPeriod = {
      '2026-04': [scoreFor('u1', 50)],
      '2026-03': [scoreFor('u1', 50)],
    };
    const cutoffs = new Map([
      ['2026-04', { p25: 65 }],
      // 2026-03 cutoff missing → not enough peer data
    ]);
    const run = consecutiveRunBelow({
      userId: 'u1',
      periodChain: ['2026-04', '2026-03'],
      scoreIndex: indexScores(scoresByPeriod),
      cutoffs,
      threshold: 'p25',
    });
    expect(run).toBe(1);
  });
});

// ── End-to-end detectAlerts ────────────────────────────────────────────

describe('detectAlerts — end-to-end', () => {
  test('worker lowConfidence in current period gets NO alert', () => {
    const scoresByPeriod = {
      '2026-04': peersWith(40, 'u1', { lowConfidence: true }),
      '2026-03': peersWith(40),
    };
    const out = detectAlerts({
      currentPeriod: '2026-04',
      periodChain: ['2026-04', '2026-03'],
      scoresByPeriod,
    });
    expect(out.alerts).toEqual([]);
  });

  test('2 consecutive months < p25 → severidad media', () => {
    const scoresByPeriod = {
      '2026-04': peersWith(40),
      '2026-03': peersWith(42),
    };
    const out = detectAlerts({
      currentPeriod: '2026-04',
      periodChain: ['2026-04', '2026-03'],
      scoresByPeriod,
    });
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0].userId).toBe('u1');
    expect(out.alerts[0].severity).toBe('media');
    expect(out.alerts[0].evidenceRefs.periods).toEqual(['2026-04', '2026-03']);
  });

  test('3 consecutive months in lower decile → severidad alta', () => {
    // Peer distribution: one worker very low, others high.
    // p10 ≈ ~15 for scores like [5, 70, 75, 80, 85]; our low worker at 5 is below.
    const peers = (lowScore) => [
      scoreFor('u1', lowScore),
      scoreFor('u2', 70),
      scoreFor('u3', 75),
      scoreFor('u4', 80),
      scoreFor('u5', 85),
    ];
    const scoresByPeriod = {
      '2026-04': peers(5),
      '2026-03': peers(8),
      '2026-02': peers(10),
    };
    const out = detectAlerts({
      currentPeriod: '2026-04',
      periodChain: ['2026-04', '2026-03', '2026-02'],
      scoresByPeriod,
    });
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0].severity).toBe('alta');
    expect(out.alerts[0].evidenceRefs.periods).toEqual(['2026-04', '2026-03', '2026-02']);
  });

  test('evidenceRefs carry scores and cutoffs per period', () => {
    const scoresByPeriod = {
      '2026-04': peersWith(40),
      '2026-03': peersWith(42),
    };
    const out = detectAlerts({
      currentPeriod: '2026-04',
      periodChain: ['2026-04', '2026-03'],
      scoresByPeriod,
    });
    const refs = out.alerts[0].evidenceRefs;
    expect(refs.scores).toEqual([40, 42]);
    expect(refs.cutoffsUsed[0].period).toBe('2026-04');
    expect(refs.cutoffsUsed[0].p25).toBeGreaterThan(40);
    expect(refs.cutoffsUsed[0].reliableCount).toBeGreaterThan(2);
  });

  test('single below-p25 month → no alert (threshold is 2)', () => {
    const scoresByPeriod = {
      '2026-04': peersWith(40),
      '2026-03': peersWith(80, 'u1'), // u1 was above p25 last month
    };
    const out = detectAlerts({
      currentPeriod: '2026-04',
      periodChain: ['2026-04', '2026-03'],
      scoresByPeriod,
    });
    expect(out.alerts).toEqual([]);
  });

  test('not enough peers in current period → no alerts', () => {
    const scoresByPeriod = {
      '2026-04': [scoreFor('u1', 40), scoreFor('u2', 80)], // only 2 reliable peers
      '2026-03': peersWith(40),
    };
    const out = detectAlerts({
      currentPeriod: '2026-04',
      periodChain: ['2026-04', '2026-03'],
      scoresByPeriod,
    });
    expect(out.alerts).toEqual([]);
  });

  test('custom thresholds adjust sensitivity', () => {
    const scoresByPeriod = {
      '2026-04': peersWith(40),
    };
    const strict = detectAlerts({
      currentPeriod: '2026-04',
      periodChain: ['2026-04'],
      scoresByPeriod,
      opts: { consecutiveMonthsForMedia: 1 },
    });
    expect(strict.alerts).toHaveLength(1);
    expect(strict.alerts[0].severity).toBe('media');
  });
});
