// Kill switch coverage invariants — Fase 6.6.
//
// Asserts that the global autopilot kill switch (`autopilot_config.paused`)
// blocks EVERY path through which the meta-agent can move Firestore state:
//
//   - the dispatcher (`executeAutopilotAction`) throws AutopilotPausedError
//     — covered by existing tests in Fases 0/1/2, not re-asserted here.
//   - the chain executor (`executeChain`) refuses up-front with
//     `code: 'AUTOPILOT_PAUSED'` BEFORE marking the chain executing. Tested
//     here.
//   - the chain preflight returns `ok: false` with a pause reason. Tested
//     here.
//
// Combined, these layers mean that a paused finca cannot start a chain,
// cannot advance an in-flight chain (next step throws), and the preflight
// at plan time surfaces the state clearly.

jest.mock('../../lib/firebase', () => {
  class FakeTs {
    constructor(ms) { this._ms = ms; }
    toMillis() { return this._ms; }
    toDate() { return new Date(this._ms); }
  }
  return {
    db: { collection: jest.fn() },
    Timestamp: {
      now: () => new FakeTs(Date.now()),
      fromMillis: ms => new FakeTs(ms),
      fromDate: d => new FakeTs(d.getTime()),
    },
    FieldValue: { serverTimestamp: () => '<<serverTimestamp>>' },
  };
});

jest.mock('../../lib/autopilotKillSwitch', () => ({
  isPaused: jest.fn(),
}));

jest.mock('../../lib/autopilotActions', () => ({
  executeAutopilotAction: jest.fn(),
}));

jest.mock('../../lib/autopilotCompensations', () => ({
  applyRollback: jest.fn(),
}));

jest.mock('../../lib/autopilotGuardrails', () => ({
  validateGuardrails: jest.fn().mockResolvedValue({ allowed: true, violations: [] }),
}));

const { db, Timestamp } = require('../../lib/firebase');
const { isPaused } = require('../../lib/autopilotKillSwitch');
const { executeAutopilotAction } = require('../../lib/autopilotActions');
const { executeChain } = require('../../lib/meta/chains/chainExecutor');
const { preflightChain } = require('../../lib/meta/chains/chainPreflight');

function makeChainDoc(overrides = {}) {
  return {
    fincaId: 'f1',
    status: 'planned',
    expiresAt: Timestamp.fromMillis(Date.now() + 3600000),
    plan: {
      steps: [
        { id: 's1', actionType: 'crear_tarea', params: {}, dependsOn: [], rationale: 'x' },
      ],
    },
    ...overrides,
  };
}

function makeChainStore(chainData) {
  const chainRef = {
    updates: [],
    update: jest.fn(async (payload) => { chainRef.updates.push(payload); }),
    get: jest.fn(async () => ({ exists: true, data: () => chainData })),
    id: 'chain1',
  };
  db.collection.mockImplementation((name) => {
    if (name === 'meta_chains') return { doc: jest.fn(() => chainRef) };
    if (name === 'autopilot_actions') {
      return { doc: jest.fn(() => ({ set: jest.fn(), update: jest.fn(), id: 'a1' })) };
    }
    if (name === 'autopilot_config') {
      return { doc: jest.fn(() => ({ get: async () => ({ exists: false }) })) };
    }
    return { doc: jest.fn(() => ({ get: async () => ({ exists: false }) })) };
  });
  return { chainRef };
}

const { applyRollback } = require('../../lib/autopilotCompensations');

beforeEach(() => {
  isPaused.mockReset();
  executeAutopilotAction.mockReset();
  applyRollback.mockReset();
  applyRollback.mockResolvedValue({ ok: true });
  db.collection.mockReset();
});

describe('kill switch blocks chain execution up front', () => {
  test('executeChain returns AUTOPILOT_PAUSED when paused', async () => {
    const { chainRef } = makeChainStore(makeChainDoc());
    isPaused.mockResolvedValue(true);

    const out = await executeChain('chain1', 'f1', { uid: 'u', email: 'e' });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('AUTOPILOT_PAUSED');

    // Critical: the chain must NOT have been marked as 'executing'.
    const updates = chainRef.update.mock.calls.map(c => c[0]);
    const markedExecuting = updates.some(u => u.status === 'executing');
    expect(markedExecuting).toBe(false);

    // And no steps were dispatched.
    expect(executeAutopilotAction).not.toHaveBeenCalled();
  });

  test('executeChain proceeds when NOT paused', async () => {
    const { chainRef } = makeChainStore(makeChainDoc());
    isPaused.mockResolvedValue(false);
    executeAutopilotAction.mockResolvedValue({ ok: true });

    const out = await executeChain('chain1', 'f1', { uid: 'u', email: 'e' });
    expect(out.ok).toBe(true);
    expect(out.status).toBe('completed');
    expect(executeAutopilotAction).toHaveBeenCalled();
  });

  test('executeChain defers to the dispatcher for pause during execution', async () => {
    // Even if somehow the kill switch is flipped AFTER executeChain started,
    // each step call to executeAutopilotAction hits the same isPaused check
    // inside the dispatcher. The executor surfaces that as a step failure.
    const { chainRef } = makeChainStore(makeChainDoc({
      plan: {
        steps: [
          { id: 's1', actionType: 'crear_tarea', params: {}, dependsOn: [], rationale: 'x' },
          { id: 's2', actionType: 'crear_tarea', params: {}, dependsOn: ['s1'], rationale: 'y' },
        ],
      },
    }));
    isPaused.mockResolvedValue(false); // allows initial entry
    executeAutopilotAction
      .mockResolvedValueOnce({ ok: true }) // s1 ok
      .mockRejectedValueOnce(new Error('autopilot paused')); // s2 fails

    const out = await executeChain('chain1', 'f1', { uid: 'u', email: 'e' });
    expect(out.ok).toBe(false);
    expect(out.status).toBe('rolled_back');
    expect(out.failedStepId).toBe('s2');
  });
});

describe('kill switch short-circuits preflight', () => {
  test('preflightChain returns blocked when paused', async () => {
    isPaused.mockResolvedValue(true);
    db.collection.mockImplementation(() => ({
      doc: jest.fn(() => ({ get: async () => ({ exists: false }) })),
    }));

    const out = await preflightChain(
      { steps: [{ id: 's1', actionType: 'crear_tarea', params: {} }] },
      'f1',
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/paused/i);
  });

  test('preflightChain runs normally when not paused', async () => {
    isPaused.mockResolvedValue(false);
    db.collection.mockImplementation(() => ({
      doc: jest.fn(() => ({ get: async () => ({ exists: false }) })),
    }));

    const out = await preflightChain(
      { steps: [{ id: 's1', actionType: 'crear_tarea', params: {} }] },
      'f1',
    );
    expect(out.ok).toBe(true);
    expect(out.blockedStepIds).toEqual([]);
  });
});
