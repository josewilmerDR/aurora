// Unit tests for callPlanner — Fase 6.1.

const {
  buildPlan,
  summarizePlan,
  DOMAIN_PRIORITY,
  DOMAIN_ACTIONS,
  ALL_DOMAINS,
} = require('../../lib/meta/orchestrator/callPlanner');

function signal(urgency, reasons = []) {
  return { urgency, reasons };
}

describe('buildPlan', () => {
  test('returns empty plan when input is missing', () => {
    expect(buildPlan(null).steps).toEqual([]);
    expect(buildPlan(undefined).steps).toEqual([]);
  });

  test('orders by urgency descending', () => {
    const signals = {
      finance: signal('low', ['Ejecución baja']),
      procurement: signal('critical', ['Déficit crítico']),
      hr: signal('medium', ['Pico de carga']),
      strategy: signal('none'),
      financing: signal('none'),
    };
    const plan = buildPlan(signals);
    expect(plan.steps.map(s => s.domain)).toEqual(['procurement', 'hr', 'finance']);
    expect(plan.steps[0].urgency).toBe('critical');
  });

  test('ties broken by stable domain priority (finance > procurement > hr > strategy > financing)', () => {
    const signals = {
      finance: signal('high'),
      procurement: signal('high'),
      hr: signal('high'),
      strategy: signal('high'),
      financing: signal('high'),
    };
    const plan = buildPlan(signals);
    expect(plan.steps.map(s => s.domain)).toEqual(['finance', 'procurement', 'hr', 'strategy', 'financing']);
  });

  test('omits steps below minUrgency', () => {
    const signals = {
      finance: signal('low'),
      procurement: signal('medium'),
      hr: signal('low'),
    };
    const plan = buildPlan(signals, { minUrgency: 'medium' });
    expect(plan.steps.map(s => s.domain)).toEqual(['procurement']);
    expect(plan.omittedCount).toBe(2);
  });

  test('omits disabled domains even at high urgency', () => {
    const signals = {
      finance: signal('critical', ['caja crítica']),
      procurement: signal('critical'),
    };
    const plan = buildPlan(signals, { domainActive: { procurement: false } });
    expect(plan.steps.map(s => s.domain)).toEqual(['finance']);
    expect(plan.omittedCount).toBe(1);
  });

  test('finance/procurement/hr steps are auto-executable with endpoints', () => {
    const plan = buildPlan({
      finance: signal('high'),
      procurement: signal('high'),
      hr: signal('high'),
    });
    for (const s of plan.steps) {
      expect(s.autoExecutable).toBe(true);
      expect(s.action).toBe('run_analyzer');
      expect(s.endpoint).toMatch(/^\/api\/autopilot\//);
      expect(s.method).toBe('POST');
    }
  });

  test('strategy/financing steps are review-only (no endpoint)', () => {
    const plan = buildPlan({
      strategy: signal('high'),
      financing: signal('medium'),
    });
    for (const s of plan.steps) {
      expect(s.autoExecutable).toBe(false);
      expect(s.endpoint).toBeNull();
      expect(s.action).toMatch(/^review_/);
    }
  });

  test('rationale concatenates reasons', () => {
    const plan = buildPlan({
      finance: signal('high', ['Caja baja.', '3 categorías excedidas.']),
    });
    expect(plan.steps[0].rationale).toBe('Caja baja. 3 categorías excedidas.');
  });

  test('none urgency is always excluded', () => {
    const plan = buildPlan({
      finance: signal('none'),
      procurement: signal('high'),
    });
    expect(plan.steps.map(s => s.domain)).toEqual(['procurement']);
    expect(plan.omittedCount).toBe(0); // `none` is never counted as omitted
  });

  test('default minUrgency is "low" — low-tier signals are included', () => {
    const plan = buildPlan({
      finance: signal('low', ['Leve']),
    });
    expect(plan.steps.length).toBe(1);
  });
});

describe('summarizePlan', () => {
  test('counts steps by urgency', () => {
    const plan = {
      steps: [
        { domain: 'finance', urgency: 'critical', autoExecutable: true },
        { domain: 'procurement', urgency: 'high', autoExecutable: true },
        { domain: 'hr', urgency: 'medium', autoExecutable: true },
        { domain: 'strategy', urgency: 'low', autoExecutable: false },
      ],
    };
    const s = summarizePlan(plan);
    expect(s.stepCount).toBe(4);
    expect(s.byUrgency).toEqual({ critical: 1, high: 1, medium: 1, low: 1 });
    expect(s.autoExecutableCount).toBe(3);
    expect(s.topUrgency).toBe('critical');
    expect(s.domains).toEqual(['finance', 'procurement', 'hr', 'strategy']);
  });

  test('empty plan yields zeros', () => {
    const s = summarizePlan({ steps: [] });
    expect(s.stepCount).toBe(0);
    expect(s.topUrgency).toBe('none');
    expect(s.autoExecutableCount).toBe(0);
  });

  test('null plan yields zeros', () => {
    const s = summarizePlan(null);
    expect(s.stepCount).toBe(0);
    expect(s.domains).toEqual([]);
  });
});

describe('invariants', () => {
  test('ALL_DOMAINS covers exactly the known five', () => {
    expect(new Set(ALL_DOMAINS)).toEqual(new Set(['finance', 'procurement', 'hr', 'strategy', 'financing']));
  });

  test('each domain has an action descriptor', () => {
    for (const d of ALL_DOMAINS) {
      expect(DOMAIN_ACTIONS[d]).toBeDefined();
    }
  });

  test('priority is unique across domains', () => {
    const priorities = ALL_DOMAINS.map(d => DOMAIN_PRIORITY[d]);
    expect(new Set(priorities).size).toBe(ALL_DOMAINS.length);
  });
});
