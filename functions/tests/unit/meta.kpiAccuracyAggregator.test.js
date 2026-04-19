// Unit tests for KPI accuracy aggregator — Fase 6.2.

const {
  computeAccuracy,
  decorate,
  emptyBucket,
  clampRate,
} = require('../../lib/meta/kpi/kpiAccuracyAggregator');

describe('clampRate', () => {
  test('null when denominator is zero', () => {
    expect(clampRate(0, 0)).toBeNull();
  });

  test('rounds to 3 decimals', () => {
    expect(clampRate(1, 3)).toBe(0.333);
    expect(clampRate(2, 3)).toBe(0.667);
  });

  test('returns 1.0 when all matched', () => {
    expect(clampRate(5, 5)).toBe(1);
  });

  test('returns 0.0 when none matched', () => {
    expect(clampRate(0, 5)).toBe(0);
  });
});

describe('decorate', () => {
  test('hitRate excludes undetermined/pending from denominator', () => {
    const d = decorate({
      match: 3, miss: 1, partial: 0,
      undetermined: 5, pending: 10,
      total: 19,
    });
    expect(d.decidedCount).toBe(4);
    expect(d.hitRate).toBe(0.75);
  });

  test('partial counts as 0.5', () => {
    const d = decorate({ match: 1, miss: 0, partial: 1, undetermined: 0, pending: 0, total: 2 });
    expect(d.decidedCount).toBe(2);
    expect(d.hitRate).toBe(0.75); // (1 + 0.5) / 2
  });

  test('hitRate null when everything is pending', () => {
    const d = decorate({ match: 0, miss: 0, partial: 0, undetermined: 0, pending: 10, total: 10 });
    expect(d.decidedCount).toBe(0);
    expect(d.hitRate).toBeNull();
  });
});

describe('computeAccuracy', () => {
  const sampleRows = [
    { actionType: 'reasignar_presupuesto', window: 30, category: 'financiera', outcome: 'match' },
    { actionType: 'reasignar_presupuesto', window: 30, category: 'financiera', outcome: 'match' },
    { actionType: 'reasignar_presupuesto', window: 30, category: 'financiera', outcome: 'miss' },
    { actionType: 'crear_orden_compra', window: 30, category: 'procurement', outcome: 'partial' },
    { actionType: 'sugerir_contratacion', window: 30, category: 'hr', outcome: 'pending' },
    { actionType: 'orchestrator_run', window: 30, outcome: 'undetermined' },
  ];

  test('overall rolls up counts and hit-rate', () => {
    const a = computeAccuracy(sampleRows);
    expect(a.overall.total).toBe(6);
    expect(a.overall.match).toBe(2);
    expect(a.overall.miss).toBe(1);
    expect(a.overall.partial).toBe(1);
    expect(a.overall.pending).toBe(1);
    expect(a.overall.undetermined).toBe(1);
    // decided = 4; hit = 2 + 0.5 = 2.5 → 0.625
    expect(a.overall.hitRate).toBe(0.625);
  });

  test('splits by actionType', () => {
    const a = computeAccuracy(sampleRows);
    expect(a.byActionType.reasignar_presupuesto.total).toBe(3);
    expect(a.byActionType.reasignar_presupuesto.hitRate).toBe(0.667);
    expect(a.byActionType.crear_orden_compra.total).toBe(1);
    expect(a.byActionType.crear_orden_compra.hitRate).toBe(0.5);
  });

  test('splits by window', () => {
    const a = computeAccuracy(sampleRows);
    expect(a.byWindow['30'].total).toBe(6);
  });

  test('splits by domain via category field', () => {
    const a = computeAccuracy(sampleRows);
    expect(a.byDomain.financiera.total).toBe(3);
    expect(a.byDomain.procurement.total).toBe(1);
    expect(a.byDomain.hr.total).toBe(1);
    // orchestrator_run row has no category → not in byDomain
    expect(a.byDomain.meta).toBeUndefined();
  });

  test('empty input produces null hitRate everywhere', () => {
    const a = computeAccuracy([]);
    expect(a.overall.total).toBe(0);
    expect(a.overall.hitRate).toBeNull();
    expect(Object.keys(a.byActionType)).toHaveLength(0);
  });

  test('unknown outcomes are ignored', () => {
    const a = computeAccuracy([
      { actionType: 'x', window: 30, outcome: 'bogus' },
      { actionType: 'x', window: 30, outcome: 'match' },
    ]);
    expect(a.overall.total).toBe(1); // only the valid one
    expect(a.overall.match).toBe(1);
  });

  test('rows without outcome are skipped', () => {
    const a = computeAccuracy([
      { actionType: 'x', window: 30 },
      { actionType: 'x', window: 30, outcome: 'match' },
    ]);
    expect(a.overall.total).toBe(1);
  });

  test('filters are echoed back in output', () => {
    const a = computeAccuracy(sampleRows, { actionType: 'reasignar_presupuesto', window: '30', domain: 'financiera' });
    expect(a.filters).toEqual({ actionType: 'reasignar_presupuesto', window: '30', domain: 'financiera' });
  });
});

describe('emptyBucket', () => {
  test('has all expected counters at zero', () => {
    const b = emptyBucket();
    expect(b).toEqual({
      match: 0, miss: 0, partial: 0,
      undetermined: 0, pending: 0, total: 0,
    });
  });
});
