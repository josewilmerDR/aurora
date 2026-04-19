// Unit tests for trustScorer — Fase 6.3.

const {
  computeTrustScores,
  HALF_LIFE_DAYS,
  MIN_EFFECTIVE_SAMPLES,
  DOMAIN_KEYS,
  _internals: { decayWeight, domainForObservation, toMillis, emptyBucket },
} = require('../../lib/meta/trust/trustScorer');

function mkObs({ outcome, actionType, category, ageDays = 0, now = Date.now() }) {
  const t1Ms = now - ageDays * 86400000;
  return {
    outcome,
    actionType,
    category: category ?? null,
    t1: { toMillis: () => t1Ms },
    evaluatedAt: { toMillis: () => t1Ms },
  };
}

describe('decayWeight', () => {
  test('fresh observation has weight ~1', () => {
    expect(decayWeight(0)).toBeCloseTo(1, 5);
  });

  test('at half-life, weight ~exp(-1) ≈ 0.368', () => {
    expect(decayWeight(HALF_LIFE_DAYS)).toBeCloseTo(Math.exp(-1), 2);
  });

  test('weight floors at 0.01', () => {
    expect(decayWeight(10000)).toBeGreaterThanOrEqual(0.01);
  });

  test('negative age treated as 0', () => {
    expect(decayWeight(-5)).toBe(0);
  });
});

describe('domainForObservation', () => {
  test('maps actionType to domain via ACTION_TYPE_TO_DOMAIN', () => {
    expect(domainForObservation({ actionType: 'reasignar_presupuesto' })).toBe('finance');
    expect(domainForObservation({ actionType: 'crear_orden_compra' })).toBe('procurement');
    expect(domainForObservation({ actionType: 'sugerir_contratacion' })).toBe('hr');
    expect(domainForObservation({ actionType: 'crear_siembra' })).toBe('strategy');
    expect(domainForObservation({ actionType: 'orchestrator_run' })).toBe('meta');
  });

  test('category field wins over actionType', () => {
    expect(domainForObservation({ actionType: 'crear_tarea', category: 'financiera' })).toBe('finance');
    expect(domainForObservation({ actionType: 'x', category: 'rrhh' })).toBe('hr');
  });

  test('unknown actionType returns null', () => {
    expect(domainForObservation({ actionType: 'bogus' })).toBeNull();
  });
});

describe('computeTrustScores', () => {
  const now = new Date('2026-05-01T00:00:00Z');

  test('returns null score for domains with no data', () => {
    const out = computeTrustScores([], { now });
    for (const d of DOMAIN_KEYS) {
      expect(out.byDomain[d].score).toBeNull();
      expect(out.byDomain[d].sampleSize).toBe(0);
    }
    expect(out.overall.score).toBeNull();
  });

  test('perfect match at full weight → score = 1', () => {
    const obs = Array.from({ length: 20 }, () => mkObs({
      outcome: 'match',
      actionType: 'reasignar_presupuesto',
      ageDays: 0,
      now: now.getTime(),
    }));
    const out = computeTrustScores(obs, { now });
    expect(out.byDomain.finance.score).toBe(1);
    expect(out.byDomain.finance.confidence).toBe(1);
    expect(out.byDomain.finance.sampleSize).toBe(20);
  });

  test('all misses → score = 0', () => {
    const obs = Array.from({ length: 15 }, () => mkObs({
      outcome: 'miss',
      actionType: 'crear_orden_compra',
      ageDays: 0,
      now: now.getTime(),
    }));
    const out = computeTrustScores(obs, { now });
    expect(out.byDomain.procurement.score).toBe(0);
  });

  test('partial counts as 0.5', () => {
    const obs = [
      mkObs({ outcome: 'match', actionType: 'reasignar_presupuesto', now: now.getTime() }),
      mkObs({ outcome: 'partial', actionType: 'reasignar_presupuesto', now: now.getTime() }),
      mkObs({ outcome: 'miss', actionType: 'reasignar_presupuesto', now: now.getTime() }),
    ];
    const out = computeTrustScores(obs, { now });
    // (1 + 0.5 + 0) / 3 = 0.5
    expect(out.byDomain.finance.score).toBe(0.5);
  });

  test('undetermined/pending are skipped entirely', () => {
    const obs = [
      mkObs({ outcome: 'match', actionType: 'reasignar_presupuesto', now: now.getTime() }),
      mkObs({ outcome: 'undetermined', actionType: 'reasignar_presupuesto', now: now.getTime() }),
      mkObs({ outcome: 'pending', actionType: 'reasignar_presupuesto', now: now.getTime() }),
    ];
    const out = computeTrustScores(obs, { now });
    expect(out.byDomain.finance.score).toBe(1);
    expect(out.byDomain.finance.sampleSize).toBe(1);
  });

  test('confidence grows with sample size up to 1', () => {
    const few = [mkObs({ outcome: 'match', actionType: 'reasignar_presupuesto', now: now.getTime() })];
    const many = Array.from({ length: MIN_EFFECTIVE_SAMPLES + 5 }, () => mkObs({
      outcome: 'match', actionType: 'reasignar_presupuesto', now: now.getTime(),
    }));
    const outFew = computeTrustScores(few, { now });
    const outMany = computeTrustScores(many, { now });
    expect(outFew.byDomain.finance.confidence).toBeLessThan(outMany.byDomain.finance.confidence);
    expect(outMany.byDomain.finance.confidence).toBe(1);
  });

  test('older observations count less than fresh ones', () => {
    // One fresh miss, one old match — the fresh miss dominates.
    const obs = [
      mkObs({ outcome: 'miss', actionType: 'reasignar_presupuesto', ageDays: 0, now: now.getTime() }),
      mkObs({ outcome: 'match', actionType: 'reasignar_presupuesto', ageDays: 365, now: now.getTime() }),
    ];
    const out = computeTrustScores(obs, { now });
    expect(out.byDomain.finance.score).toBeLessThan(0.5);
  });

  test('orchestrator observations go to the meta bucket', () => {
    const obs = [mkObs({ outcome: 'match', actionType: 'orchestrator_run', now: now.getTime() })];
    const out = computeTrustScores(obs, { now });
    expect(out.byDomain.meta.sampleSize).toBe(1);
    expect(out.byDomain.finance.sampleSize).toBe(0);
  });

  test('unknown actionType is not assigned to any domain but still contributes to overall', () => {
    const obs = [mkObs({ outcome: 'match', actionType: 'bogus', now: now.getTime() })];
    const out = computeTrustScores(obs, { now });
    expect(out.overall.score).toBe(1);
    for (const d of DOMAIN_KEYS) {
      expect(out.byDomain[d].sampleSize).toBe(0);
    }
  });
});

describe('emptyBucket', () => {
  test('zeroed counters', () => {
    expect(emptyBucket()).toEqual({ weightedValue: 0, totalWeight: 0, count: 0 });
  });
});
