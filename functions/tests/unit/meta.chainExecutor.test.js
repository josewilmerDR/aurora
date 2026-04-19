// Unit tests for chainExecutor — Fase 6.4.
// Mocks Firestore and the action dispatcher to exercise:
//   - Happy path: all steps execute in topological order → status=completed
//   - Step failure triggers rollback cascade in reverse order
//   - Already-terminal chains cannot be re-executed
//   - Expired chains are short-circuited

jest.mock('../../lib/firebase', () => {
  class FakeTs {
    constructor(ms) { this._ms = ms; }
    toMillis() { return this._ms; }
    toDate() { return new Date(this._ms); }
  }
  const now = () => new FakeTs(Date.now());
  const fromMillis = ms => new FakeTs(ms);
  const fromDate = d => new FakeTs(d.getTime());
  return {
    db: {
      collection: jest.fn(),
    },
    Timestamp: { now, fromMillis, fromDate },
    FieldValue: { serverTimestamp: () => '<<serverTimestamp>>' },
  };
});

jest.mock('../../lib/autopilotActions', () => ({
  executeAutopilotAction: jest.fn(),
}));

jest.mock('../../lib/autopilotCompensations', () => ({
  applyRollback: jest.fn(),
}));

const { db, Timestamp } = require('../../lib/firebase');
const { executeAutopilotAction } = require('../../lib/autopilotActions');
const { applyRollback } = require('../../lib/autopilotCompensations');
const { executeChain, isExpired, loadChain } = require('../../lib/meta/chains/chainExecutor');

function makeChainDoc(overrides = {}) {
  return {
    fincaId: 'f1',
    status: 'planned',
    expiresAt: Timestamp.fromMillis(Date.now() + 3600000),
    plan: {
      steps: [
        { id: 's1', actionType: 'reasignar_presupuesto', params: {}, dependsOn: [], rationale: 'x' },
        { id: 's2', actionType: 'crear_solicitud_compra', params: {}, dependsOn: ['s1'], rationale: 'x' },
        { id: 's3', actionType: 'crear_tarea', params: {}, dependsOn: ['s2'], rationale: 'x' },
      ],
    },
    ...overrides,
  };
}

// Fake doc + collection builder that captures writes.
function makeFakeStore(chainData) {
  const chainRef = {
    updates: [],
    update: jest.fn(async (payload) => { chainRef.updates.push(payload); }),
    get: jest.fn(async () => ({
      exists: true,
      data: () => chainData,
    })),
    id: 'chain1',
  };
  const actionRef = {
    set: jest.fn(),
    update: jest.fn(),
    id: 'action-mock',
  };
  db.collection.mockImplementation((name) => {
    if (name === 'meta_chains') {
      return { doc: jest.fn(() => chainRef) };
    }
    if (name === 'autopilot_actions') {
      return { doc: jest.fn(() => ({ ...actionRef, id: `action-${Math.random().toString(36).slice(2, 8)}` })) };
    }
    return { doc: jest.fn(() => ({ get: async () => ({ exists: false }) })) };
  });
  return { chainRef };
}

beforeEach(() => {
  executeAutopilotAction.mockReset();
  applyRollback.mockReset();
  db.collection.mockReset();
});

describe('isExpired', () => {
  test('returns true when expiresAt is in the past', () => {
    const c = { expiresAt: Timestamp.fromMillis(Date.now() - 1000) };
    expect(isExpired(c)).toBe(true);
  });

  test('returns false when expiresAt is in the future', () => {
    const c = { expiresAt: Timestamp.fromMillis(Date.now() + 1000) };
    expect(isExpired(c)).toBe(false);
  });

  test('returns false when expiresAt is absent', () => {
    expect(isExpired({})).toBe(false);
  });
});

describe('loadChain', () => {
  test('returns FORBIDDEN when fincaId mismatch', async () => {
    makeFakeStore({ fincaId: 'other', status: 'planned' });
    const out = await loadChain('chain1', 'f1');
    expect(out.ok).toBe(false);
    expect(out.code).toBe('FORBIDDEN');
  });

  test('returns NOT_FOUND when doc does not exist', async () => {
    db.collection.mockImplementation(() => ({
      doc: jest.fn(() => ({ get: async () => ({ exists: false }) })),
    }));
    const out = await loadChain('missing', 'f1');
    expect(out.ok).toBe(false);
    expect(out.code).toBe('NOT_FOUND');
  });
});

describe('executeChain — gate checks', () => {
  test('rejects non-executable status', async () => {
    makeFakeStore(makeChainDoc({ status: 'completed' }));
    const out = await executeChain('chain1', 'f1', { uid: 'u', email: 'e' });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('CONFLICT');
  });

  test('rejects expired chain and marks as expired', async () => {
    const { chainRef } = makeFakeStore(makeChainDoc({
      expiresAt: Timestamp.fromMillis(Date.now() - 1000),
    }));
    const out = await executeChain('chain1', 'f1', { uid: 'u', email: 'e' });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('EXPIRED');
    expect(chainRef.update).toHaveBeenCalled();
    const lastUpdate = chainRef.update.mock.calls[chainRef.update.mock.calls.length - 1][0];
    expect(lastUpdate.status).toBe('expired');
  });
});

describe('executeChain — happy path', () => {
  test('executes all steps in topological order and marks completed', async () => {
    const { chainRef } = makeFakeStore(makeChainDoc());
    executeAutopilotAction.mockResolvedValue({ ok: true });
    const out = await executeChain('chain1', 'f1', { uid: 'u', email: 'e' });
    expect(out.ok).toBe(true);
    expect(out.status).toBe('completed');
    expect(out.executedSteps).toBe(3);
    expect(executeAutopilotAction).toHaveBeenCalledTimes(3);
    // Verify order of execution via the sequence of calls.
    expect(executeAutopilotAction.mock.calls[0][0]).toBe('reasignar_presupuesto');
    expect(executeAutopilotAction.mock.calls[1][0]).toBe('crear_solicitud_compra');
    expect(executeAutopilotAction.mock.calls[2][0]).toBe('crear_tarea');
    // Final update sets status=completed.
    const finalUpdate = chainRef.update.mock.calls[chainRef.update.mock.calls.length - 1][0];
    expect(finalUpdate.status).toBe('completed');
  });
});

describe('executeChain — failure + rollback cascade', () => {
  test('failure on step 2 triggers rollback of step 1 in reverse order', async () => {
    const { chainRef } = makeFakeStore(makeChainDoc());
    executeAutopilotAction
      .mockResolvedValueOnce({ ok: true, result: 's1' })  // s1 succeeds
      .mockRejectedValueOnce(new Error('boom at s2'));    // s2 fails
    applyRollback.mockResolvedValue({ ok: true, result: 'rolled' });

    const out = await executeChain('chain1', 'f1', { uid: 'u', email: 'e' });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('CHAIN_FAILED');
    expect(out.status).toBe('rolled_back');
    expect(out.failedStepId).toBe('s2');

    // Only s1 was executed; rollback was called on s1 only.
    expect(applyRollback).toHaveBeenCalledTimes(1);

    // Chain status ends in 'rolled_back'.
    const finalUpdate = chainRef.update.mock.calls[chainRef.update.mock.calls.length - 1][0];
    expect(finalUpdate.status).toBe('rolled_back');
  });

  test('partial rollback failure marks chain as rolled_back_partial', async () => {
    const { chainRef } = makeFakeStore(makeChainDoc());
    executeAutopilotAction
      .mockResolvedValueOnce({ ok: true })  // s1 ok
      .mockResolvedValueOnce({ ok: true })  // s2 ok
      .mockRejectedValueOnce(new Error('boom at s3')); // s3 fails
    // Rollback of s2 fails; rollback of s1 succeeds.
    applyRollback
      .mockResolvedValueOnce({ ok: false, code: 'COMPENSATION_BLOCKED', message: 'stuck' })
      .mockResolvedValueOnce({ ok: true });

    const out = await executeChain('chain1', 'f1', { uid: 'u', email: 'e' });
    expect(out.ok).toBe(false);
    expect(out.status).toBe('rolled_back_partial');
    const finalUpdate = chainRef.update.mock.calls[chainRef.update.mock.calls.length - 1][0];
    expect(finalUpdate.status).toBe('rolled_back_partial');
    expect(finalUpdate['execution.rollback'].fullyApplied).toBe(false);
  });

  test('failure on first step rolls back nothing and completes as rolled_back', async () => {
    const { chainRef } = makeFakeStore(makeChainDoc());
    executeAutopilotAction.mockRejectedValueOnce(new Error('boom at s1'));
    const out = await executeChain('chain1', 'f1', { uid: 'u', email: 'e' });
    expect(out.ok).toBe(false);
    expect(applyRollback).not.toHaveBeenCalled();
    const finalUpdate = chainRef.update.mock.calls[chainRef.update.mock.calls.length - 1][0];
    // With no executed steps, rollback.allOk is vacuously true → status=rolled_back.
    expect(finalUpdate.status).toBe('rolled_back');
  });
});
