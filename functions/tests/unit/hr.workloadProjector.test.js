// Unit tests for workloadProjector. Pure.

const {
  projectWorkload,
  startOfWeekUTC,
  DEFAULT_ACTIVITY_HOURS,
  MIN_HORIZON_WEEKS,
  MAX_HORIZON_WEEKS,
} = require('../../lib/hr/workloadProjector');

const MS_PER_DAY = 24 * 3_600_000;

// A fixed "now" that's a Wednesday — helps test week alignment.
// 2026-04-22 is a Wednesday UTC.
const FIXED_NOW = new Date('2026-04-22T12:00:00Z');
const MONDAY_OF_NOW = new Date('2026-04-20T00:00:00Z'); // week-start for FIXED_NOW

describe('startOfWeekUTC', () => {
  test('Wednesday snaps back to Monday', () => {
    expect(startOfWeekUTC(FIXED_NOW.getTime())).toBe(MONDAY_OF_NOW.getTime());
  });

  test('Sunday snaps back to previous Monday', () => {
    const sunday = new Date('2026-04-26T10:00:00Z');
    expect(startOfWeekUTC(sunday.getTime())).toBe(MONDAY_OF_NOW.getTime());
  });

  test('Monday stays the same', () => {
    const monday = new Date('2026-04-20T10:00:00Z');
    expect(startOfWeekUTC(monday.getTime())).toBe(MONDAY_OF_NOW.getTime());
  });
});

describe('projectWorkload — horizon and empty inputs', () => {
  test('always spans the full horizon, even with no data', () => {
    const out = projectWorkload({ siembras: [], packages: [], horizonWeeks: 8, now: FIXED_NOW });
    expect(out.weeks).toHaveLength(8);
    for (const w of out.weeks) {
      expect(w.totalActivities).toBe(0);
      expect(w.estimatedPersonHours).toBe(0);
      expect(w.demandedWorkers).toBe(0);
      expect(w.byLabor).toEqual([]);
    }
  });

  test('clamps horizon below MIN', () => {
    const out = projectWorkload({ siembras: [], packages: [], horizonWeeks: 0, now: FIXED_NOW });
    expect(out.horizonWeeks).toBe(MIN_HORIZON_WEEKS);
  });

  test('clamps horizon above MAX', () => {
    const out = projectWorkload({ siembras: [], packages: [], horizonWeeks: 999, now: FIXED_NOW });
    expect(out.horizonWeeks).toBe(MAX_HORIZON_WEEKS);
  });

  test('defaults horizon when omitted', () => {
    const out = projectWorkload({ siembras: [], packages: [], now: FIXED_NOW });
    expect(out.horizonWeeks).toBe(12);
  });

  test('weekStart dates are Mondays', () => {
    const out = projectWorkload({ siembras: [], packages: [], horizonWeeks: 3, now: FIXED_NOW });
    // 2026-04-20 is Monday.
    expect(out.weeks[0].weekStart).toBe('2026-04-20');
    expect(out.weeks[1].weekStart).toBe('2026-04-27');
    expect(out.weeks[2].weekStart).toBe('2026-05-04');
  });
});

describe('projectWorkload — activity scheduling', () => {
  const pkg = {
    id: 'pkg1',
    activities: [
      { day: 0,  name: 'Siembra' },
      { day: 7,  name: 'Riego' },
      { day: 14, name: 'Fertilización' },
      { day: 21, name: 'Monitoreo' },
    ],
  };

  test('positions activities by siembra.fecha + day offset', () => {
    // siembra on FIXED_NOW Wednesday → day 0 falls in week 0 (Monday-anchored).
    const siembra = { id: 's1', packageId: 'pkg1', fecha: FIXED_NOW };
    const out = projectWorkload({
      siembras: [siembra], packages: [pkg], horizonWeeks: 6, now: FIXED_NOW,
    });
    // day 0 → wed 2026-04-22 → week 0
    // day 7 → wed 2026-04-29 → week 1
    // day 14 → wed 2026-05-06 → week 2
    // day 21 → wed 2026-05-13 → week 3
    expect(out.weeks[0].totalActivities).toBe(1);
    expect(out.weeks[1].totalActivities).toBe(1);
    expect(out.weeks[2].totalActivities).toBe(1);
    expect(out.weeks[3].totalActivities).toBe(1);
    expect(out.weeks[4].totalActivities).toBe(0);
  });

  test('estimatedPersonHours uses defaultActivityHours', () => {
    const siembra = { id: 's1', packageId: 'pkg1', fecha: FIXED_NOW };
    const out = projectWorkload({
      siembras: [siembra], packages: [pkg], horizonWeeks: 6, now: FIXED_NOW,
      opts: { defaultActivityHours: 6 },
    });
    expect(out.weeks[0].estimatedPersonHours).toBe(6);
    expect(out.assumptions.defaultActivityHours).toBe(6);
  });

  test('default activity hours used when opts omitted', () => {
    const siembra = { id: 's1', packageId: 'pkg1', fecha: FIXED_NOW };
    const out = projectWorkload({
      siembras: [siembra], packages: [pkg], horizonWeeks: 6, now: FIXED_NOW,
    });
    expect(out.weeks[0].estimatedPersonHours).toBe(DEFAULT_ACTIVITY_HOURS);
  });

  test('excludes cerrado siembras and reports in diagnostics', () => {
    const siembras = [
      { id: 's1', packageId: 'pkg1', fecha: FIXED_NOW, cerrado: true },
    ];
    const out = projectWorkload({
      siembras, packages: [pkg], horizonWeeks: 6, now: FIXED_NOW,
    });
    expect(out.weeks[0].totalActivities).toBe(0);
    expect(out.diagnostics.droppedClosed).toBe(1);
  });

  test('drops siembras with no matching package', () => {
    const siembra = { id: 's1', packageId: 'pkg-missing', fecha: FIXED_NOW };
    const out = projectWorkload({
      siembras: [siembra], packages: [pkg], horizonWeeks: 6, now: FIXED_NOW,
    });
    expect(out.diagnostics.droppedNoPackage).toBe(1);
    expect(out.summary.totalActivitiesScheduled).toBe(0);
  });

  test('drops activities landing outside the horizon window', () => {
    // A siembra 30 days ago still has activities day=0 (far past) and
    // day=35 (in the future). Only day=35 may land inside horizon=6 weeks.
    const past = new Date(FIXED_NOW.getTime() - 30 * MS_PER_DAY);
    const siembra = { id: 's1', packageId: 'pkg1', fecha: past };
    const out = projectWorkload({
      siembras: [siembra], packages: [pkg], horizonWeeks: 2, now: FIXED_NOW,
    });
    expect(out.summary.totalActivitiesScheduled).toBeLessThan(pkg.activities.length);
    expect(out.diagnostics.droppedOutOfWindow).toBeGreaterThan(0);
  });

  test('aggregates byLabor counts within a week', () => {
    // Create 3 siembras on the same date with same package → 3 activities of
    // each labor in matching weeks.
    const s = (id) => ({ id, packageId: 'pkg1', fecha: FIXED_NOW });
    const out = projectWorkload({
      siembras: [s('s1'), s('s2'), s('s3')], packages: [pkg], horizonWeeks: 6, now: FIXED_NOW,
    });
    expect(out.weeks[0].byLabor[0]).toEqual({ labor: 'Siembra', count: 3 });
    expect(out.weeks[1].byLabor[0]).toEqual({ labor: 'Riego', count: 3 });
  });

  test('supports paqueteId as alternate field name', () => {
    const siembra = { id: 's1', paqueteId: 'pkg1', fecha: FIXED_NOW };
    const out = projectWorkload({
      siembras: [siembra], packages: [pkg], horizonWeeks: 2, now: FIXED_NOW,
    });
    expect(out.summary.totalActivitiesScheduled).toBeGreaterThan(0);
  });

  test('Firestore Timestamp-like fecha is handled', () => {
    const tsLike = { seconds: Math.floor(FIXED_NOW.getTime() / 1000), nanoseconds: 0 };
    const siembra = { id: 's1', packageId: 'pkg1', fecha: tsLike };
    const out = projectWorkload({
      siembras: [siembra], packages: [pkg], horizonWeeks: 2, now: FIXED_NOW,
    });
    expect(out.weeks[0].totalActivities).toBe(1);
  });

  test('demandedWorkers uses ceil(hours / avgWeeklyHoursPerWorker)', () => {
    const siembras = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`, packageId: 'pkg1', fecha: FIXED_NOW,
    }));
    const out = projectWorkload({
      siembras, packages: [pkg], horizonWeeks: 2, now: FIXED_NOW,
      opts: { defaultActivityHours: 8, avgWeeklyHoursPerWorker: 40 },
    });
    // Week 0: 10 activities × 8h = 80h. 80 / 40 = 2 workers.
    expect(out.weeks[0].estimatedPersonHours).toBe(80);
    expect(out.weeks[0].demandedWorkers).toBe(2);
  });

  test('demandedWorkers ceils fractional results up', () => {
    const siembra = { id: 's1', packageId: 'pkg1', fecha: FIXED_NOW };
    const out = projectWorkload({
      siembras: [siembra], packages: [pkg], horizonWeeks: 2, now: FIXED_NOW,
      opts: { defaultActivityHours: 5, avgWeeklyHoursPerWorker: 40 },
    });
    // week 0: 1 act * 5h = 5h. 5/40 = 0.125 → ceil = 1
    expect(out.weeks[0].demandedWorkers).toBe(1);
  });
});
