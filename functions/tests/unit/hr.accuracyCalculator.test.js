// Unit tests for accuracyCalculator. Pure.

const {
  computeAccuracy,
  cutoffForWindow,
  clampHitRate,
  isResolvedWithOutcome,
  VALID_RESOLUTIONS,
} = require('../../lib/hr/accuracyCalculator');

function auditRow({
  type = 'sugerir_contratacion',
  humanResolution,
  outcomeMatchedReality = null,
} = {}) {
  return { type, humanResolution, outcomeMatchedReality };
}

describe('VALID_RESOLUTIONS', () => {
  test('lists the three recognized resolutions', () => {
    expect(VALID_RESOLUTIONS).toEqual(new Set(['approved', 'rejected', 'ignored']));
  });
});

describe('clampHitRate', () => {
  test('returns null when denominator is 0', () => {
    expect(clampHitRate(0, 0)).toBeNull();
    expect(clampHitRate(5, 0)).toBeNull();
  });

  test('rounds to 3 decimals', () => {
    expect(clampHitRate(1, 3)).toBe(0.333);
    expect(clampHitRate(2, 3)).toBe(0.667);
  });

  test('perfect and zero hit rates', () => {
    expect(clampHitRate(5, 5)).toBe(1);
    expect(clampHitRate(0, 5)).toBe(0);
  });
});

describe('isResolvedWithOutcome', () => {
  test('true only when outcomeMatchedReality is a boolean', () => {
    expect(isResolvedWithOutcome({ outcomeMatchedReality: true })).toBe(true);
    expect(isResolvedWithOutcome({ outcomeMatchedReality: false })).toBe(true);
  });

  test('null or missing → false (pending)', () => {
    expect(isResolvedWithOutcome({ outcomeMatchedReality: null })).toBe(false);
    expect(isResolvedWithOutcome({})).toBe(false);
    expect(isResolvedWithOutcome(null)).toBe(false);
  });
});

describe('computeAccuracy — empty + guards', () => {
  test('empty input returns zero totals and null hitRate', () => {
    const out = computeAccuracy([]);
    expect(out.overall.total).toBe(0);
    expect(out.overall.hitRate).toBeNull();
    expect(out.byType).toEqual({});
  });

  test('non-array input coerced to empty', () => {
    const out = computeAccuracy(null);
    expect(out.overall.total).toBe(0);
  });

  test('windowMonths opt flows through untouched', () => {
    const out = computeAccuracy([], { windowMonths: 6 });
    expect(out.windowMonths).toBe(6);
  });
});

describe('computeAccuracy — aggregation', () => {
  test('all resolutions counted at top level', () => {
    const rows = [
      auditRow({ humanResolution: 'approved' }),
      auditRow({ humanResolution: 'approved' }),
      auditRow({ humanResolution: 'rejected' }),
      auditRow({ humanResolution: 'ignored' }),
    ];
    const out = computeAccuracy(rows);
    expect(out.overall.approved).toBe(2);
    expect(out.overall.rejected).toBe(1);
    expect(out.overall.ignored).toBe(1);
    expect(out.overall.total).toBe(4);
  });

  test('pending rows excluded from hitRate denominator', () => {
    const rows = [
      auditRow({ humanResolution: 'approved', outcomeMatchedReality: true }),
      auditRow({ humanResolution: 'approved', outcomeMatchedReality: true }),
      auditRow({ humanResolution: 'approved', outcomeMatchedReality: false }),
      auditRow({ humanResolution: 'approved', outcomeMatchedReality: null }), // pending
    ];
    const out = computeAccuracy(rows);
    expect(out.overall.outcomeMatched).toBe(2);
    expect(out.overall.outcomeUnmatched).toBe(1);
    expect(out.overall.pending).toBe(1);
    expect(out.overall.decidedCount).toBe(3);
    expect(out.overall.hitRate).toBe(0.667);
  });

  test('break-down by type accumulates independently', () => {
    const rows = [
      auditRow({ type: 'sugerir_contratacion', humanResolution: 'approved', outcomeMatchedReality: true }),
      auditRow({ type: 'sugerir_contratacion', humanResolution: 'approved', outcomeMatchedReality: false }),
      auditRow({ type: 'sugerir_revision_desempeno', humanResolution: 'approved', outcomeMatchedReality: true }),
    ];
    const out = computeAccuracy(rows);
    expect(out.byType.sugerir_contratacion.total).toBe(2);
    expect(out.byType.sugerir_contratacion.hitRate).toBe(0.5);
    expect(out.byType.sugerir_revision_desempeno.hitRate).toBe(1);
  });

  test('rows with invalid humanResolution do not increment resolution counters', () => {
    const rows = [
      auditRow({ humanResolution: 'purple' }),
      { /* no fields */ },
    ];
    const out = computeAccuracy(rows);
    expect(out.overall.approved).toBe(0);
    expect(out.overall.rejected).toBe(0);
    expect(out.overall.ignored).toBe(0);
    expect(out.overall.total).toBe(2);
  });

  test('missing type falls under "unknown" bucket', () => {
    const rows = [{ humanResolution: 'approved', outcomeMatchedReality: true }];
    const out = computeAccuracy(rows);
    expect(out.byType.unknown.total).toBe(1);
  });

  test('hitRate meets 90% threshold when enough matched outcomes', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      auditRow({ humanResolution: 'approved', outcomeMatchedReality: i < 9 })
    );
    const out = computeAccuracy(rows);
    expect(out.overall.hitRate).toBe(0.9); // exactly at threshold
  });
});

describe('cutoffForWindow', () => {
  test('default 6 months back from now', () => {
    const now = new Date(Date.UTC(2026, 5, 15)); // Jun 15, 2026
    const cut = cutoffForWindow(undefined, now);
    // 6 months back from Jun is December of prior year, day 1 UTC
    expect(cut.toISOString().slice(0, 10)).toBe('2025-12-01');
  });

  test('custom months count', () => {
    const now = new Date(Date.UTC(2026, 5, 15));
    const cut = cutoffForWindow(3, now);
    expect(cut.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  test('negative or zero months fall back to 6', () => {
    const now = new Date(Date.UTC(2026, 5, 15));
    expect(cutoffForWindow(0, now).toISOString().slice(0, 10)).toBe('2025-12-01');
    expect(cutoffForWindow(-5, now).toISOString().slice(0, 10)).toBe('2025-12-01');
  });
});
