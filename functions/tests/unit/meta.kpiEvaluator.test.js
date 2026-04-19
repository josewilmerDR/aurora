// Unit tests for kpiEvaluator — Fase 6.2.
// We mock `kpiContextLoader.loadContext` at the jest level to avoid
// touching Firestore; this keeps evaluator logic (template lookup,
// error handling, doc-ID shape) isolated.

jest.mock('../../lib/meta/kpi/kpiContextLoader', () => ({
  loadContext: jest.fn(),
}));

const { loadContext } = require('../../lib/meta/kpi/kpiContextLoader');
const {
  evaluateSource,
  buildObservationDoc,
  observationDocId,
  resolveT0,
} = require('../../lib/meta/kpi/kpiEvaluator');

beforeEach(() => {
  loadContext.mockReset();
});

describe('observationDocId', () => {
  test('concatenates sourceType + sourceId + window', () => {
    expect(observationDocId({ sourceType: 'autopilot_action', sourceId: 'a1', window: 30 }))
      .toBe('autopilot_action_a1_30');
  });
});

describe('resolveT0', () => {
  test('orchestrator_run uses createdAt', () => {
    const d = new Date('2026-04-01T00:00:00Z');
    expect(resolveT0({ createdAt: d }, 'orchestrator_run')).toBe(d);
  });

  test('autopilot_action prefers executedAt', () => {
    const executed = new Date('2026-04-02T00:00:00Z');
    const created = new Date('2026-03-01T00:00:00Z');
    expect(resolveT0({ executedAt: executed, createdAt: created }, 'autopilot_action')).toBe(executed);
  });

  test('falls back to createdAt if executedAt missing', () => {
    const created = new Date('2026-03-01T00:00:00Z');
    expect(resolveT0({ createdAt: created }, 'autopilot_action')).toBe(created);
  });

  test('returns null when no timestamps present', () => {
    expect(resolveT0({}, 'autopilot_action')).toBeNull();
  });
});

describe('evaluateSource', () => {
  test('returns undetermined when action has no type', async () => {
    const r = await evaluateSource({
      source: { id: 'a1' }, sourceType: 'autopilot_action',
      window: 30, fincaId: 'f1',
    });
    expect(r.observation.outcome).toBe('undetermined');
    expect(r.template).toBeNull();
  });

  test('returns undetermined when template not registered', async () => {
    const r = await evaluateSource({
      source: { id: 'a1', type: 'crear_tarea' }, sourceType: 'autopilot_action',
      window: 30, fincaId: 'f1',
    });
    expect(r.observation.outcome).toBe('undetermined');
    expect(r.template).toBeNull();
  });

  test('runs the template when registered', async () => {
    loadContext.mockResolvedValue({
      sourceBudget: { assignedAmount: 1000 },
      sourceExecution: 500,
    });
    const action = {
      id: 'a1',
      type: 'reasignar_presupuesto',
      executedAt: new Date('2026-04-01T00:00:00Z'),
      params: { sourceBudgetId: 'b1', targetBudgetId: 'b2', amount: 500 },
    };
    const r = await evaluateSource({
      source: action, sourceType: 'autopilot_action',
      window: 30, fincaId: 'f1',
    });
    expect(r.template).not.toBeNull();
    expect(r.observation.outcome).toBe('match');
    expect(r.docId).toBe('autopilot_action_a1_30');
  });

  test('captures context load errors as undetermined', async () => {
    loadContext.mockRejectedValue(new Error('firestore boom'));
    const action = {
      id: 'a1',
      type: 'reasignar_presupuesto',
      executedAt: new Date(),
      params: { sourceBudgetId: 'b1' },
    };
    const r = await evaluateSource({
      source: action, sourceType: 'autopilot_action',
      window: 30, fincaId: 'f1',
    });
    expect(r.observation.outcome).toBe('undetermined');
    expect(r.observation.detail).toMatch(/firestore boom/);
  });

  test('captures template evaluate errors as undetermined', async () => {
    // Load context cleanly; the template will throw because the action
    // is malformed in a way the template does not defensively guard.
    loadContext.mockResolvedValue({ products: null });
    const action = {
      id: 'a1',
      type: 'crear_orden_compra',
      executedAt: new Date(),
      params: null, // template accesses params.items — should still short-circuit gracefully
    };
    const r = await evaluateSource({
      source: action, sourceType: 'autopilot_action',
      window: 30, fincaId: 'f1',
    });
    // The template defensively handles null params and returns undetermined.
    expect(['undetermined']).toContain(r.observation.outcome);
  });
});

describe('buildObservationDoc', () => {
  test('produces the Firestore payload with all expected keys', () => {
    const evalResult = {
      template: { metric: 'x' },
      observation: { metric: 'x', value: { a: 1 }, expected: 'x', outcome: 'match', detail: 'ok' },
      docId: 'autopilot_action_a1_30',
      t0: new Date('2026-04-01T00:00:00Z'),
      evaluatedAt: new Date('2026-05-01T00:00:00Z'),
    };
    const payload = buildObservationDoc({
      evalResult,
      source: { id: 'a1', type: 'reasignar_presupuesto', categoria: 'financiera' },
      sourceType: 'autopilot_action',
      window: 30,
      fincaId: 'f1',
    });
    expect(payload.fincaId).toBe('f1');
    expect(payload.sourceType).toBe('autopilot_action');
    expect(payload.sourceId).toBe('a1');
    expect(payload.actionType).toBe('reasignar_presupuesto');
    expect(payload.window).toBe(30);
    expect(payload.metric).toBe('x');
    expect(payload.outcome).toBe('match');
    expect(payload.category).toBe('financiera');
    expect(payload.docId).toBe('autopilot_action_a1_30');
  });

  test('orchestrator_run uses `orchestrator_run` as actionType', () => {
    const evalResult = {
      template: { metric: 'y' },
      observation: { outcome: 'partial', metric: 'y' },
      docId: 'orchestrator_run_r1_30',
      t0: new Date(),
    };
    const payload = buildObservationDoc({
      evalResult,
      source: { id: 'r1' },
      sourceType: 'orchestrator_run',
      window: 30,
      fincaId: 'f1',
    });
    expect(payload.actionType).toBe('orchestrator_run');
    expect(payload.category).toBeNull();
  });
});
