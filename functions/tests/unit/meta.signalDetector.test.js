// Unit tests for signalDetector — Fase 6.1.
// The detector is pure; we feed it shapes that mirror buildFincaState output.

const {
  detectSignals,
  URGENCY_RANK,
  DEFAULT_THRESHOLDS,
  _internals: { detectFinance, detectProcurement, detectHr, detectStrategy, detectFinancing, highestUrgency },
} = require('../../lib/meta/orchestrator/signalDetector');

const T = DEFAULT_THRESHOLDS;

describe('highestUrgency', () => {
  test('picks the highest-ranked candidate', () => {
    const winner = highestUrgency([
      { urgency: 'low', reason: 'a' },
      { urgency: 'high', reason: 'b' },
      { urgency: 'medium', reason: 'c' },
    ]);
    expect(winner.urgency).toBe('high');
    expect(winner.reason).toBe('b');
  });

  test('returns none when input is empty', () => {
    expect(highestUrgency([]).urgency).toBe('none');
    expect(highestUrgency([null, undefined]).urgency).toBe('none');
  });
});

describe('detectFinance', () => {
  test('critical when minBalance below cash floor', () => {
    const state = {
      finance: {
        cashProjection: { minBalance: -500, negativeWeeks: 2, startingBalance: 1000 },
        budgetExecution: { summary: { overBudgetCount: 0, overallPercent: 50 } },
      },
    };
    const out = detectFinance(state, T);
    expect(out.urgency).toBe('critical');
    expect(out.reasons.length).toBeGreaterThan(0);
  });

  test('high when minBalance low relative to starting', () => {
    const state = {
      finance: {
        cashProjection: { minBalance: 50, negativeWeeks: 0, startingBalance: 1000 },
        budgetExecution: { summary: { overBudgetCount: 0, overallPercent: 50 } },
      },
    };
    expect(detectFinance(state, T).urgency).toBe('high');
  });

  test('medium when over-budget categories exist', () => {
    const state = {
      finance: {
        cashProjection: { minBalance: 500, negativeWeeks: 0, startingBalance: 1000 },
        budgetExecution: { summary: { overBudgetCount: 1, overallPercent: 90 } },
      },
    };
    expect(detectFinance(state, T).urgency).toBe('medium');
  });

  test('critical when many over-budget categories', () => {
    const state = {
      finance: {
        cashProjection: { minBalance: 500, negativeWeeks: 0, startingBalance: 1000 },
        budgetExecution: { summary: { overBudgetCount: 5, overallPercent: 120 } },
      },
    };
    expect(detectFinance(state, T).urgency).toBe('critical');
  });

  test('none when nothing concerning', () => {
    const state = {
      finance: {
        cashProjection: { minBalance: 800, negativeWeeks: 0, startingBalance: 1000 },
        budgetExecution: { summary: { overBudgetCount: 0, overallPercent: 40 } },
      },
    };
    expect(detectFinance(state, T).urgency).toBe('none');
  });

  test('none when finance section missing', () => {
    expect(detectFinance({}, T).urgency).toBe('none');
    expect(detectFinance(null, T).urgency).toBe('none');
  });
});

describe('detectProcurement', () => {
  test('critical when any critical gap', () => {
    const state = { procurement: { gapsByUrgency: { critical: 1, high: 0, medium: 0, low: 0 }, gapCount: 1 } };
    expect(detectProcurement(state, T).urgency).toBe('critical');
  });

  test('high when multiple high gaps', () => {
    const state = { procurement: { gapsByUrgency: { critical: 0, high: 3, medium: 0, low: 0 }, gapCount: 3 } };
    expect(detectProcurement(state, T).urgency).toBe('high');
  });

  test('medium when several medium gaps', () => {
    const state = { procurement: { gapsByUrgency: { critical: 0, high: 0, medium: 2, low: 0 }, gapCount: 2 } };
    expect(detectProcurement(state, T).urgency).toBe('medium');
  });

  test('low when only few low gaps', () => {
    const state = { procurement: { gapsByUrgency: { critical: 0, high: 0, medium: 0, low: 3 }, gapCount: 3 } };
    expect(detectProcurement(state, T).urgency).toBe('low');
  });

  test('none when zero gaps', () => {
    const state = { procurement: { gapsByUrgency: { critical: 0, high: 0, medium: 0, low: 0 }, gapCount: 0 } };
    expect(detectProcurement(state, T).urgency).toBe('none');
  });
});

describe('detectHr', () => {
  test('critical when peak is far above baseline', () => {
    const state = {
      hr: {
        workloadProjection: { peakWeek: { estimatedPersonHours: 200 } },
        capacity: { baselineWeeklyHours: 100 },
        performanceTrend: {},
      },
    };
    expect(detectHr(state, T).urgency).toBe('critical');
  });

  test('high when peak exceeds baseline by 25%', () => {
    const state = {
      hr: {
        workloadProjection: { peakWeek: { estimatedPersonHours: 130 } },
        capacity: { baselineWeeklyHours: 100 },
        performanceTrend: {},
      },
    };
    expect(detectHr(state, T).urgency).toBe('high');
  });

  test('high when performance drops sharply', () => {
    const state = {
      hr: {
        workloadProjection: { peakWeek: { estimatedPersonHours: 50 } },
        capacity: { baselineWeeklyHours: 100 },
        performanceTrend: { delta: -12 },
      },
    };
    expect(detectHr(state, T).urgency).toBe('high');
  });

  test('none when everything balanced', () => {
    const state = {
      hr: {
        workloadProjection: { peakWeek: { estimatedPersonHours: 40 } },
        capacity: { baselineWeeklyHours: 100 },
        performanceTrend: { delta: 2 },
      },
    };
    expect(detectHr(state, T).urgency).toBe('none');
  });
});

describe('detectStrategy', () => {
  test('high when no active plan past threshold month', () => {
    const state = { strategy: { activeAnnualPlan: null, recentSignals: [] } };
    const now = new Date(Date.UTC(2026, 3, 10)); // April = month 4 ≥ 3
    expect(detectStrategy(state, T, now).urgency).toBe('high');
  });

  test('low when no plan but still early in year', () => {
    const state = { strategy: { activeAnnualPlan: null, recentSignals: [] } };
    const now = new Date(Date.UTC(2026, 0, 10)); // January
    expect(detectStrategy(state, T, now).urgency).toBe('low');
  });

  test('medium when high-confidence signals exist', () => {
    const state = {
      strategy: {
        activeAnnualPlan: { version: 3 },
        recentSignals: [{ confidence: 0.85 }],
      },
    };
    const now = new Date(Date.UTC(2026, 5, 1));
    expect(detectStrategy(state, T, now).urgency).toBe('medium');
  });

  test('none when plan active and no signals', () => {
    const state = { strategy: { activeAnnualPlan: { version: 3 }, recentSignals: [] } };
    const now = new Date(Date.UTC(2026, 5, 1));
    expect(detectStrategy(state, T, now).urgency).toBe('none');
  });
});

describe('detectFinancing', () => {
  test('medium when recent tomar-recommendation', () => {
    const now = new Date(Date.UTC(2026, 3, 19));
    const recentIso = new Date(now.getTime() - 3 * 86400000).toISOString();
    const state = {
      financing: {
        lastDebtSimulation: { recommendation: 'tomar', createdAt: recentIso },
      },
    };
    expect(detectFinancing(state, T, now).urgency).toBe('medium');
  });

  test('low when recent conditional-recommendation', () => {
    const now = new Date(Date.UTC(2026, 3, 19));
    const recentIso = new Date(now.getTime() - 3 * 86400000).toISOString();
    const state = {
      financing: {
        lastDebtSimulation: { recommendation: 'tomar_condicional', createdAt: recentIso },
      },
    };
    expect(detectFinancing(state, T, now).urgency).toBe('low');
  });

  test('none when no last sim', () => {
    expect(detectFinancing({ financing: {} }, T, new Date()).urgency).toBe('none');
  });

  test('none when sim is old', () => {
    const now = new Date(Date.UTC(2026, 3, 19));
    const staleIso = new Date(now.getTime() - 60 * 86400000).toISOString();
    const state = {
      financing: {
        lastDebtSimulation: { recommendation: 'tomar', createdAt: staleIso },
      },
    };
    expect(detectFinancing(state, T, now).urgency).toBe('none');
  });
});

describe('detectSignals (composite)', () => {
  test('emits urgency per domain + rank map', () => {
    const state = {
      finance: {
        cashProjection: { minBalance: -100, negativeWeeks: 1, startingBalance: 1000 },
        budgetExecution: { summary: { overBudgetCount: 0 } },
      },
      procurement: { gapsByUrgency: { critical: 1, high: 0, medium: 0, low: 0 }, gapCount: 1 },
      hr: { workloadProjection: { peakWeek: { estimatedPersonHours: 0 } }, capacity: {}, performanceTrend: {} },
      strategy: { activeAnnualPlan: null, recentSignals: [] },
      financing: { lastDebtSimulation: null },
    };
    const now = new Date(Date.UTC(2026, 3, 19));
    const out = detectSignals(state, { now });
    expect(out.finance.urgency).toBe('critical');
    expect(out.procurement.urgency).toBe('critical');
    expect(out.urgencyRank.finance).toBe(URGENCY_RANK.critical);
    expect(out.urgencyRank.procurement).toBe(URGENCY_RANK.critical);
  });

  test('custom thresholds override defaults', () => {
    const state = {
      finance: {
        cashProjection: { minBalance: 100, negativeWeeks: 0, startingBalance: 1000 },
        budgetExecution: { summary: { overBudgetCount: 0 } },
      },
    };
    // With default cashLowFraction=0.1, minBalance=100 is NOT < 100. So high.
    // Crank fraction to 0.5 → threshold 500; 100 < 500 → high.
    const strict = detectSignals(state, { thresholds: { cashLowFraction: 0.5 } });
    expect(strict.finance.urgency).toBe('high');
  });
});
