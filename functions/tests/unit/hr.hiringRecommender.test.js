// Unit tests for hiringRecommender. Pure.

const {
  recommendHiring,
  weeklyShortfall,
  findShortfallRuns,
  classifyUrgency,
  recommendedAction,
  DEFAULT_OPTS,
} = require('../../lib/hr/hiringRecommender');

function week(weekStart, estimatedPersonHours) {
  return {
    weekStart,
    weekEnd: weekStart,
    totalActivities: 0,
    estimatedPersonHours,
    byLabor: [],
    demandedWorkers: 0,
  };
}

const FLAT_CAPACITY = {
  baselineWeeklyHours: 200,
  surplusWeeklyHours: 0,
  permanentCount: 5,
  temporalCount: 0,
  avgWeeklyHoursPermanent: 40,
  permanentWorkers: [],
  temporalWorkers: [],
};

// ── Guards on input shape ───────────────────────────────────────────────

describe('recommendHiring — input guards', () => {
  test('returns empty recommendations when projection missing', () => {
    const out = recommendHiring({ capacity: FLAT_CAPACITY });
    expect(out.recommendations).toEqual([]);
    expect(out.reason).toBe('missing_projection');
  });

  test('returns empty recommendations when capacity missing', () => {
    const out = recommendHiring({ projection: { weeks: [] } });
    expect(out.recommendations).toEqual([]);
    expect(out.reason).toBe('missing_capacity');
  });

  test('no shortfall → no_shortfall reason', () => {
    const projection = { weeks: [week('2026-05-04', 100), week('2026-05-11', 150)] };
    const out = recommendHiring({ projection, capacity: FLAT_CAPACITY });
    expect(out.recommendations).toEqual([]);
    expect(out.reason).toBe('no_shortfall');
  });
});

// ── Detection ──────────────────────────────────────────────────────────

describe('weeklyShortfall', () => {
  test('positive when demand exceeds capacity', () => {
    expect(weeklyShortfall(week('2026-05-04', 250), 200)).toBe(50);
  });

  test('zero when demand at or below capacity', () => {
    expect(weeklyShortfall(week('2026-05-04', 200), 200)).toBe(0);
    expect(weeklyShortfall(week('2026-05-04', 100), 200)).toBe(0);
  });

  test('null when capacity missing', () => {
    expect(weeklyShortfall(week('2026-05-04', 250), null)).toBeNull();
    expect(weeklyShortfall(week('2026-05-04', 250), undefined)).toBeNull();
  });
});

describe('findShortfallRuns', () => {
  test('consecutive overload weeks become a single run', () => {
    const weeks = [
      week('2026-05-04', 100),
      week('2026-05-11', 260),
      week('2026-05-18', 300),
      week('2026-05-25', 280),
      week('2026-06-01', 100),
    ];
    const runs = findShortfallRuns(weeks, 200, DEFAULT_OPTS.triggerShortfallHours);
    expect(runs).toHaveLength(1);
    expect(runs[0].length).toBe(3);
    expect(runs[0].startIndex).toBe(1);
    expect(runs[0].endIndex).toBe(3);
    expect(runs[0].peakShortfallHours).toBe(100);
  });

  test('a sub-trigger week splits runs', () => {
    const weeks = [
      week('2026-05-04', 300),  // shortfall 100 → triggers
      week('2026-05-11', 202),  // shortfall 2 → below trigger → splits
      week('2026-05-18', 250),  // shortfall 50 → triggers new run
    ];
    const runs = findShortfallRuns(weeks, 200, DEFAULT_OPTS.triggerShortfallHours);
    expect(runs).toHaveLength(2);
    expect(runs[0].length).toBe(1);
    expect(runs[1].length).toBe(1);
  });

  test('empty when no weeks exceed trigger', () => {
    const weeks = [week('2026-05-04', 201), week('2026-05-11', 203)]; // below trigger 4h
    expect(findShortfallRuns(weeks, 200, 4)).toEqual([]);
  });
});

// ── Classification ─────────────────────────────────────────────────────

describe('classifyUrgency', () => {
  test('first 3 weeks → alta', () => {
    expect(classifyUrgency({ startIndex: 0 }, 3)).toBe('alta');
    expect(classifyUrgency({ startIndex: 2 }, 3)).toBe('alta');
  });

  test('weeks 3..5 → media', () => {
    expect(classifyUrgency({ startIndex: 3 }, 3)).toBe('media');
    expect(classifyUrgency({ startIndex: 5 }, 3)).toBe('media');
  });

  test('week 6+ → baja', () => {
    expect(classifyUrgency({ startIndex: 6 }, 3)).toBe('baja');
    expect(classifyUrgency({ startIndex: 20 }, 3)).toBe('baja');
  });
});

describe('recommendedAction', () => {
  test('short runs → contratar_temporal', () => {
    expect(recommendedAction({ length: 1 }, 4)).toBe('contratar_temporal');
    expect(recommendedAction({ length: 3 }, 4)).toBe('contratar_temporal');
  });

  test('runs ≥ threshold → contratar_permanente', () => {
    expect(recommendedAction({ length: 4 }, 4)).toBe('contratar_permanente');
    expect(recommendedAction({ length: 10 }, 4)).toBe('contratar_permanente');
  });
});

// ── End-to-end recommendHiring ─────────────────────────────────────────

describe('recommendHiring — full flow', () => {
  test('single urgent week spike → 1 temporal recommendation with alta urgency', () => {
    const projection = {
      weeks: [
        week('2026-05-04', 300),           // 100h over cap → single spike
        week('2026-05-11', 100),
        week('2026-05-18', 100),
      ],
    };
    const out = recommendHiring({ projection, capacity: FLAT_CAPACITY });
    expect(out.recommendations).toHaveLength(1);
    const rec = out.recommendations[0];
    expect(rec.urgency).toBe('alta');
    expect(rec.recommendedAction).toBe('contratar_temporal');
    expect(rec.workersShort).toBe(Math.ceil(100 / 40));
    expect(rec.reasoning).toMatch(/déficit/i);
    expect(rec.reasoning).not.toMatch(/\$|USD|salario/i);
  });

  test('sustained shortfall ≥ 4 weeks → contratar_permanente', () => {
    const projection = {
      weeks: [
        week('2026-05-04', 260),
        week('2026-05-11', 260),
        week('2026-05-18', 260),
        week('2026-05-25', 260),
        week('2026-06-01', 100),
      ],
    };
    const out = recommendHiring({ projection, capacity: FLAT_CAPACITY });
    expect(out.recommendations).toHaveLength(1);
    expect(out.recommendations[0].recommendedAction).toBe('contratar_permanente');
    expect(out.recommendations[0].consecutiveWeeks).toBe(4);
  });

  test('late shortfall (week 10+) → baja urgency', () => {
    const weeks = [];
    for (let i = 0; i < 12; i++) weeks.push(week(`2026-W${i}`, 100));
    weeks[10] = week('2026-W10', 300);
    const out = recommendHiring({ projection: { weeks }, capacity: FLAT_CAPACITY });
    expect(out.recommendations[0].urgency).toBe('baja');
  });

  test('multiple disjoint runs produce multiple recommendations', () => {
    const projection = {
      weeks: [
        week('w1', 300),
        week('w2', 100),
        week('w3', 100),
        week('w4', 300),
      ],
    };
    const out = recommendHiring({ projection, capacity: FLAT_CAPACITY });
    expect(out.recommendations).toHaveLength(2);
  });

  test('reasoning never mentions salary, wages, or currency figures', () => {
    const projection = { weeks: [week('2026-05-04', 500)] };
    const out = recommendHiring({ projection, capacity: FLAT_CAPACITY });
    expect(out.recommendations[0].reasoning).not.toMatch(/\$|USD|salario|sueldo|pago/i);
  });

  test('summary carries capacity inputs back through', () => {
    const projection = { weeks: [week('2026-05-04', 300)] };
    const out = recommendHiring({ projection, capacity: FLAT_CAPACITY });
    expect(out.summary.baselineWeeklyHours).toBe(200);
    expect(out.summary.avgWeeklyHoursPerWorker).toBe(40);
  });

  test('custom triggerShortfallHours raises the bar', () => {
    const projection = { weeks: [week('2026-05-04', 210)] }; // 10h over cap
    const strict = recommendHiring({
      projection, capacity: FLAT_CAPACITY,
      opts: { triggerShortfallHours: 50 },
    });
    expect(strict.recommendations).toEqual([]);
  });
});
