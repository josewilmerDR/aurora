// Unit tests for chainValidator — Fase 6.4.
// Includes architectural invariants: HR / financing / enviar_notificacion
// must NEVER be chainable.

const {
  validateChain,
  topologicalSort,
  isActionChainable,
  ALLOWED_CHAIN_ACTIONS,
  FORBIDDEN_CHAIN_ACTIONS,
  MAX_CHAIN_STEPS,
  MAX_DEPENDS_ON_PER_STEP,
} = require('../../lib/meta/chains/chainValidator');

const { HR_ACTION_TYPES } = require('../../lib/hr/hrActionCaps');

describe('topologicalSort', () => {
  test('linear chain orders by dependencies', () => {
    const out = topologicalSort([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
    ]);
    expect(out.ok).toBe(true);
    expect(out.order).toEqual(['a', 'b', 'c']);
  });

  test('respects insertion order for independent steps', () => {
    const out = topologicalSort([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: [] },
      { id: 'c', dependsOn: ['a', 'b'] },
    ]);
    expect(out.ok).toBe(true);
    expect(out.order).toEqual(['a', 'b', 'c']);
  });

  test('detects cycles', () => {
    const out = topologicalSort([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
    ]);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/cycle/i);
  });

  test('detects unknown dependency', () => {
    const out = topologicalSort([
      { id: 'a', dependsOn: ['ghost'] },
    ]);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/unknown/i);
  });
});

describe('isActionChainable', () => {
  test('returns true for allowed action', () => {
    expect(isActionChainable('crear_tarea')).toBe(true);
    expect(isActionChainable('reasignar_presupuesto')).toBe(true);
  });

  test('returns false for HR actions', () => {
    for (const t of HR_ACTION_TYPES) {
      expect(isActionChainable(t)).toBe(false);
    }
  });

  test('returns false for enviar_notificacion (not compensable)', () => {
    expect(isActionChainable('enviar_notificacion')).toBe(false);
  });

  test('returns false for unknown actions', () => {
    expect(isActionChainable('bogus')).toBe(false);
    expect(isActionChainable('')).toBe(false);
    expect(isActionChainable(null)).toBe(false);
  });
});

describe('validateChain — happy path', () => {
  test('valid chain returns orderedStepIds', () => {
    const out = validateChain({
      steps: [
        { id: 's1', actionType: 'reasignar_presupuesto', params: { sourceBudgetId: 'a', targetBudgetId: 'b', amount: 100 }, dependsOn: [], rationale: 'x' },
        { id: 's2', actionType: 'crear_solicitud_compra', params: { items: [] }, dependsOn: ['s1'], rationale: 'x' },
      ],
    });
    expect(out.ok).toBe(true);
    expect(out.orderedStepIds).toEqual(['s1', 's2']);
  });

  test('single step is valid', () => {
    const out = validateChain({
      steps: [{ id: 's1', actionType: 'crear_tarea', params: {}, dependsOn: [], rationale: 'x' }],
    });
    expect(out.ok).toBe(true);
  });
});

describe('validateChain — architectural constraints', () => {
  test('rejects chain with ANY HR action type', () => {
    for (const t of HR_ACTION_TYPES) {
      const out = validateChain({
        steps: [{ id: 's1', actionType: t, params: {}, dependsOn: [], rationale: 'x' }],
      });
      expect(out.ok).toBe(false);
      expect(out.reasons.some(r => r.toLowerCase().includes('forbidden'))).toBe(true);
    }
  });

  test('rejects chain with financing actions', () => {
    const financingTypes = ['aplicar_credito', 'tomar_prestamo', 'firmar_pagare'];
    for (const t of financingTypes) {
      const out = validateChain({
        steps: [{ id: 's1', actionType: t, params: {}, dependsOn: [], rationale: 'x' }],
      });
      expect(out.ok).toBe(false);
    }
  });

  test('rejects chain with enviar_notificacion (not compensable)', () => {
    const out = validateChain({
      steps: [{ id: 's1', actionType: 'enviar_notificacion', params: {}, dependsOn: [], rationale: 'x' }],
    });
    expect(out.ok).toBe(false);
    expect(out.reasons.some(r => r.includes('forbidden'))).toBe(true);
  });
});

describe('validateChain — shape + DAG checks', () => {
  test('rejects empty chain', () => {
    const out = validateChain({ steps: [] });
    expect(out.ok).toBe(false);
    expect(out.reasons[0]).toMatch(/at least one/i);
  });

  test('rejects chain exceeding MAX_CHAIN_STEPS', () => {
    const steps = [];
    for (let i = 0; i < MAX_CHAIN_STEPS + 1; i++) {
      steps.push({ id: `s${i}`, actionType: 'crear_tarea', params: {}, dependsOn: [], rationale: 'x' });
    }
    const out = validateChain({ steps });
    expect(out.ok).toBe(false);
    expect(out.reasons[0]).toMatch(/exceeds maximum/i);
  });

  test('rejects duplicate step ids', () => {
    const out = validateChain({
      steps: [
        { id: 's1', actionType: 'crear_tarea', params: {}, dependsOn: [], rationale: 'x' },
        { id: 's1', actionType: 'crear_tarea', params: {}, dependsOn: [], rationale: 'x' },
      ],
    });
    expect(out.ok).toBe(false);
    expect(out.reasons.some(r => r.includes('Duplicate'))).toBe(true);
  });

  test('rejects missing id', () => {
    const out = validateChain({
      steps: [{ actionType: 'crear_tarea', params: {}, dependsOn: [], rationale: 'x' }],
    });
    expect(out.ok).toBe(false);
    expect(out.reasons[0]).toMatch(/missing/i);
  });

  test('rejects missing actionType', () => {
    const out = validateChain({
      steps: [{ id: 's1', params: {}, dependsOn: [], rationale: 'x' }],
    });
    expect(out.ok).toBe(false);
    expect(out.reasons.some(r => r.includes('actionType is required'))).toBe(true);
  });

  test('rejects self-dependency', () => {
    const out = validateChain({
      steps: [{ id: 's1', actionType: 'crear_tarea', params: {}, dependsOn: ['s1'], rationale: 'x' }],
    });
    expect(out.ok).toBe(false);
    expect(out.reasons.some(r => r.includes('cannot depend on itself'))).toBe(true);
  });

  test('rejects dependency cycle', () => {
    const out = validateChain({
      steps: [
        { id: 's1', actionType: 'crear_tarea', params: {}, dependsOn: ['s2'], rationale: 'x' },
        { id: 's2', actionType: 'crear_tarea', params: {}, dependsOn: ['s1'], rationale: 'x' },
      ],
    });
    expect(out.ok).toBe(false);
    expect(out.reasons[0]).toMatch(/cycle/i);
  });

  test('rejects unknown dependency', () => {
    const out = validateChain({
      steps: [{ id: 's1', actionType: 'crear_tarea', params: {}, dependsOn: ['ghost'], rationale: 'x' }],
    });
    expect(out.ok).toBe(false);
    expect(out.reasons[0]).toMatch(/unknown/i);
  });

  test('rejects non-object params', () => {
    const out = validateChain({
      steps: [{ id: 's1', actionType: 'crear_tarea', params: 'oops', dependsOn: [], rationale: 'x' }],
    });
    expect(out.ok).toBe(false);
    expect(out.reasons.some(r => r.includes('params must be an object'))).toBe(true);
  });

  test('rejects too many dependsOn per step', () => {
    const deps = [];
    const earlier = [];
    for (let i = 0; i < MAX_DEPENDS_ON_PER_STEP + 1; i++) {
      deps.push(`p${i}`);
      earlier.push({ id: `p${i}`, actionType: 'crear_tarea', params: {}, dependsOn: [], rationale: 'x' });
    }
    const out = validateChain({
      steps: [
        ...earlier,
        { id: 's1', actionType: 'crear_tarea', params: {}, dependsOn: deps, rationale: 'x' },
      ],
    });
    expect(out.ok).toBe(false);
    expect(out.reasons.some(r => r.includes('dependsOn exceeds'))).toBe(true);
  });
});

// ── INVARIANT ──────────────────────────────────────────────────────────────
// This is the architectural contract: chains never include actions that
// Aurora cannot safely auto-execute or rollback. The test below is the
// last guard against an accidental addition sneaking past review.
describe('architectural invariant: chainable set is bounded and pure', () => {
  test('ALLOWED does not overlap with FORBIDDEN', () => {
    const allowed = new Set(ALLOWED_CHAIN_ACTIONS);
    for (const f of FORBIDDEN_CHAIN_ACTIONS) {
      expect(allowed.has(f)).toBe(false);
    }
  });

  test('ALLOWED contains none of the HR types', () => {
    const allowed = new Set(ALLOWED_CHAIN_ACTIONS);
    for (const hr of HR_ACTION_TYPES) {
      expect(allowed.has(hr)).toBe(false);
    }
  });

  test('ALLOWED contains neither enviar_notificacion nor financing types', () => {
    const allowed = new Set(ALLOWED_CHAIN_ACTIONS);
    expect(allowed.has('enviar_notificacion')).toBe(false);
    for (const t of ['aplicar_credito', 'tomar_prestamo', 'contratar_deuda', 'firmar_pagare']) {
      expect(allowed.has(t)).toBe(false);
    }
  });
});
