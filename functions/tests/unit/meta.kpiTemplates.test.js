// Unit tests for KPI templates — Fase 6.2.
// All templates are pure; we feed them pre-loaded `ctx` objects.

const {
  ALL_TEMPLATES,
  HR_AUDIT_ACTION_TYPES,
  VALID_OUTCOMES,
  VALID_WINDOWS,
  findTemplate,
  windowsFor,
  _templates: {
    tpl_reasignar_presupuesto_30,
    tpl_crear_orden_compra_30,
    tpl_crear_solicitud_compra_30,
    tpl_orchestrator_run_30,
    hrAuditTemplate,
  },
} = require('../../lib/meta/kpi/kpiTemplates');

describe('registry invariants', () => {
  test('every template declares sourceType, actionType, window, metric', () => {
    for (const t of ALL_TEMPLATES) {
      expect(typeof t.sourceType).toBe('string');
      expect(typeof t.actionType).toBe('string');
      expect(VALID_WINDOWS).toContain(t.window);
      expect(typeof t.metric).toBe('string');
      expect(typeof t.evaluate).toBe('function');
    }
  });

  test('no duplicate (sourceType, actionType, window) triples', () => {
    const keys = ALL_TEMPLATES.map(t => `${t.sourceType}|${t.actionType}|${t.window}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('findTemplate returns null for unregistered triples', () => {
    expect(findTemplate({ sourceType: 'autopilot_action', actionType: 'bogus', window: 30 })).toBeNull();
    expect(findTemplate({ sourceType: 'autopilot_action', actionType: 'reasignar_presupuesto', window: 99 })).toBeNull();
  });

  test('findTemplate returns the template for known triples', () => {
    expect(findTemplate({ sourceType: 'autopilot_action', actionType: 'reasignar_presupuesto', window: 30 }))
      .toBe(tpl_reasignar_presupuesto_30);
  });

  test('windowsFor returns registered windows sorted', () => {
    expect(windowsFor('autopilot_action', 'sugerir_contratacion')).toEqual([30]);
    expect(windowsFor('orchestrator_run', 'orchestrator_run')).toEqual([30]);
    expect(windowsFor('autopilot_action', 'bogus')).toEqual([]);
  });

  test('HR_AUDIT_ACTION_TYPES has the five known types', () => {
    expect(HR_AUDIT_ACTION_TYPES).toEqual([
      'sugerir_contratacion',
      'sugerir_despido',
      'sugerir_sancion',
      'sugerir_memorando',
      'sugerir_revision_desempeno',
    ]);
  });
});

// ─── reasignar_presupuesto@30 ──────────────────────────────────────────────

describe('tpl_reasignar_presupuesto_30', () => {
  const action = { params: { sourceBudgetId: 'b1', targetBudgetId: 'b2', amount: 500 } };

  test('match when source is back below assigned', () => {
    const out = tpl_reasignar_presupuesto_30.evaluate(action, {
      sourceBudget: { assignedAmount: 1500 },
      sourceExecution: 1200,
    });
    expect(out.outcome).toBe('match');
    expect(out.value.percentConsumed).toBe(80);
  });

  test('miss when source still over-budget', () => {
    const out = tpl_reasignar_presupuesto_30.evaluate(action, {
      sourceBudget: { assignedAmount: 1000 },
      sourceExecution: 1300,
    });
    expect(out.outcome).toBe('miss');
    expect(out.value.overBudget).toBe(true);
  });

  test('undetermined when context missing', () => {
    expect(tpl_reasignar_presupuesto_30.evaluate(action, {}).outcome).toBe('undetermined');
    expect(tpl_reasignar_presupuesto_30.evaluate(action, { sourceBudget: null, sourceExecution: 100 }).outcome).toBe('undetermined');
    expect(tpl_reasignar_presupuesto_30.evaluate(action, { sourceBudget: { assignedAmount: 0 }, sourceExecution: 50 }).outcome).toBe('undetermined');
  });
});

// ─── crear_orden_compra@30 ─────────────────────────────────────────────────

describe('tpl_crear_orden_compra_30', () => {
  const action = {
    params: { items: [
      { productoId: 'p1' },
      { productoId: 'p2' },
    ]},
  };

  test('match when all products are at or above minimum', () => {
    const out = tpl_crear_orden_compra_30.evaluate(action, {
      products: [
        { id: 'p1', stockActual: 100, stockMinimo: 50 },
        { id: 'p2', stockActual: 10, stockMinimo: 5 },
      ],
    });
    expect(out.outcome).toBe('match');
    expect(out.value.ratio).toBe(1);
  });

  test('miss when none above minimum', () => {
    const out = tpl_crear_orden_compra_30.evaluate(action, {
      products: [
        { id: 'p1', stockActual: 20, stockMinimo: 50 },
        { id: 'p2', stockActual: 0, stockMinimo: 5 },
      ],
    });
    expect(out.outcome).toBe('miss');
  });

  test('partial when some products below, some above', () => {
    const out = tpl_crear_orden_compra_30.evaluate(action, {
      products: [
        { id: 'p1', stockActual: 100, stockMinimo: 50 },
        { id: 'p2', stockActual: 0, stockMinimo: 5 },
      ],
    });
    expect(out.outcome).toBe('partial');
    expect(out.value.ratio).toBe(0.5);
  });

  test('undetermined when no referenced products found', () => {
    const out = tpl_crear_orden_compra_30.evaluate(action, { products: [] });
    expect(out.outcome).toBe('undetermined');
  });

  test('undetermined when OC has no items', () => {
    const out = tpl_crear_orden_compra_30.evaluate({ params: { items: [] } }, { products: [] });
    expect(out.outcome).toBe('undetermined');
  });

  test('deleted products are skipped without penalty', () => {
    const out = tpl_crear_orden_compra_30.evaluate(action, {
      products: [{ id: 'p1', stockActual: 100, stockMinimo: 50 }],
    });
    expect(out.outcome).toBe('match'); // 1/1 checked is a match
    expect(out.value.checked).toBe(1);
  });
});

// ─── crear_solicitud_compra@30 ─────────────────────────────────────────────

describe('tpl_crear_solicitud_compra_30', () => {
  const action = { executionResult: { solicitudId: 's1' } };

  test('match when estado is completada/convertida/aprobada/procesada', () => {
    for (const estado of ['completada', 'convertida', 'aprobada', 'procesada']) {
      const out = tpl_crear_solicitud_compra_30.evaluate(action, { solicitud: { estado } });
      expect(out.outcome).toBe('match');
    }
  });

  test('miss when estado is cancelada/rechazada/pendiente', () => {
    for (const estado of ['cancelada', 'rechazada', 'pendiente']) {
      const out = tpl_crear_solicitud_compra_30.evaluate(action, { solicitud: { estado } });
      expect(out.outcome).toBe('miss');
    }
  });

  test('match case-insensitive on estado', () => {
    expect(tpl_crear_solicitud_compra_30.evaluate(action, { solicitud: { estado: 'COMPLETADA' } }).outcome).toBe('match');
  });

  test('undetermined when solicitud not found', () => {
    expect(tpl_crear_solicitud_compra_30.evaluate(action, { solicitud: null }).outcome).toBe('undetermined');
  });

  test('undetermined when estado is unknown', () => {
    expect(tpl_crear_solicitud_compra_30.evaluate(action, { solicitud: { estado: 'weird_state' } }).outcome).toBe('undetermined');
  });
});

// ─── orchestrator_run@30 ───────────────────────────────────────────────────

describe('tpl_orchestrator_run_30', () => {
  test('match when majority of flagged domains dropped in urgency and none rose', () => {
    const run = {
      signals: {
        finance: { urgency: 'critical' },
        procurement: { urgency: 'high' },
      },
      finalSteps: [
        { domain: 'finance' },
        { domain: 'procurement' },
      ],
    };
    const out = tpl_orchestrator_run_30.evaluate(run, {
      currentSignals: {
        finance: { urgency: 'low' },
        procurement: { urgency: 'medium' },
      },
    });
    expect(out.outcome).toBe('match');
    expect(out.value.dropped).toBe(2);
  });

  test('miss when all stayed or rose', () => {
    const run = {
      signals: { finance: { urgency: 'medium' } },
      finalSteps: [{ domain: 'finance' }],
    };
    const out = tpl_orchestrator_run_30.evaluate(run, {
      currentSignals: { finance: { urgency: 'critical' } },
    });
    expect(out.outcome).toBe('miss');
    expect(out.value.rose).toBe(1);
  });

  test('partial when mixed outcomes', () => {
    const run = {
      signals: {
        finance: { urgency: 'critical' },
        procurement: { urgency: 'medium' },
      },
      finalSteps: [
        { domain: 'finance' },
        { domain: 'procurement' },
      ],
    };
    const out = tpl_orchestrator_run_30.evaluate(run, {
      currentSignals: {
        finance: { urgency: 'low' },
        procurement: { urgency: 'medium' }, // unchanged
      },
    });
    // 1/2 dropped, no rose, but 50% threshold is met with no rises → should be match
    expect(['match', 'partial']).toContain(out.outcome);
  });

  test('miss when a rise drags outcome', () => {
    const run = {
      signals: {
        finance: { urgency: 'medium' },
        procurement: { urgency: 'medium' },
      },
      finalSteps: [
        { domain: 'finance' },
        { domain: 'procurement' },
      ],
    };
    const out = tpl_orchestrator_run_30.evaluate(run, {
      currentSignals: {
        finance: { urgency: 'critical' },
        procurement: { urgency: 'critical' },
      },
    });
    expect(out.outcome).toBe('miss');
  });

  test('undetermined when plan had no steps', () => {
    const out = tpl_orchestrator_run_30.evaluate({ finalSteps: [] }, { currentSignals: {} });
    expect(out.outcome).toBe('undetermined');
  });
});

// ─── hrAuditTemplate ────────────────────────────────────────────────────────

describe('hrAuditTemplate', () => {
  const tpl = hrAuditTemplate('sugerir_contratacion', 30);

  test('match when audit outcomeMatchedReality is true', () => {
    const out = tpl.evaluate({}, { audit: { outcomeMatchedReality: true, humanResolution: 'approved' } });
    expect(out.outcome).toBe('match');
  });

  test('miss when audit outcomeMatchedReality is false', () => {
    const out = tpl.evaluate({}, { audit: { outcomeMatchedReality: false, humanResolution: 'rejected' } });
    expect(out.outcome).toBe('miss');
  });

  test('pending when audit exists but outcome is null', () => {
    const out = tpl.evaluate({}, { audit: { outcomeMatchedReality: null } });
    expect(out.outcome).toBe('pending');
  });

  test('pending when audit does not exist', () => {
    expect(tpl.evaluate({}, { audit: null }).outcome).toBe('pending');
  });
});

// ─── VALID_OUTCOMES exhaustive ─────────────────────────────────────────────

describe('outcome vocabulary', () => {
  test('templates emit only outcomes in VALID_OUTCOMES', () => {
    // Synthetic minimum eval → whatever outcome comes, it must be in the set.
    const samples = [
      { tpl: tpl_reasignar_presupuesto_30, action: { params: { sourceBudgetId: 'b1' } }, ctx: { sourceBudget: { assignedAmount: 100 }, sourceExecution: 50 } },
      { tpl: tpl_crear_orden_compra_30, action: { params: { items: [{ productoId: 'p1' }] } }, ctx: { products: [{ id: 'p1', stockActual: 100, stockMinimo: 50 }] } },
      { tpl: tpl_crear_solicitud_compra_30, action: { executionResult: { solicitudId: 's1' } }, ctx: { solicitud: { estado: 'completada' } } },
      { tpl: hrAuditTemplate('sugerir_contratacion', 30), action: {}, ctx: { audit: { outcomeMatchedReality: true } } },
    ];
    for (const s of samples) {
      expect(VALID_OUTCOMES).toContain(s.tpl.evaluate(s.action, s.ctx).outcome);
    }
  });
});
