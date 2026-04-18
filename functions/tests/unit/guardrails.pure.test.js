/**
 * Unit tests for pure helpers in lib/autopilotGuardrails.js.
 * These don't touch Firestore — fast, always runnable.
 */

const {
  isWithinQuietHours,
  isWeekend,
  computeOrderAmount,
  validateGuardrails,
  DEFAULTS,
} = require('../../lib/autopilotGuardrails');

describe('isWithinQuietHours', () => {
  test('returns false when start or end is missing', () => {
    expect(isWithinQuietHours(new Date(), null, '06:00')).toBe(false);
    expect(isWithinQuietHours(new Date(), '20:00', null)).toBe(false);
  });

  test('same-day window: 09:00–17:00', () => {
    const inside  = new Date(2026, 0, 1, 12, 0); // noon
    const before  = new Date(2026, 0, 1, 8, 59);
    const edgeEnd = new Date(2026, 0, 1, 17, 0); // end is exclusive
    expect(isWithinQuietHours(inside,  '09:00', '17:00')).toBe(true);
    expect(isWithinQuietHours(before,  '09:00', '17:00')).toBe(false);
    expect(isWithinQuietHours(edgeEnd, '09:00', '17:00')).toBe(false);
  });

  test('overnight window (crosses midnight): 20:00–06:00', () => {
    const lateEvening = new Date(2026, 0, 1, 21, 30);
    const earlyMorning = new Date(2026, 0, 1, 3, 0);
    const midAfternoon = new Date(2026, 0, 1, 15, 0);
    expect(isWithinQuietHours(lateEvening,  '20:00', '06:00')).toBe(true);
    expect(isWithinQuietHours(earlyMorning, '20:00', '06:00')).toBe(true);
    expect(isWithinQuietHours(midAfternoon, '20:00', '06:00')).toBe(false);
  });

  test('malformed start/end returns false', () => {
    expect(isWithinQuietHours(new Date(), 'foo', 'bar')).toBe(false);
  });
});

describe('isWeekend', () => {
  test('Saturday and Sunday are weekend', () => {
    // Local-time dates (avoid ISO string parse ambiguity).
    const sat = new Date(2026, 0, 3);  // Jan 3 2026 is Saturday
    const sun = new Date(2026, 0, 4);
    expect(isWeekend(sat)).toBe(true);
    expect(isWeekend(sun)).toBe(true);
  });

  test('weekdays are not weekend', () => {
    const mon = new Date(2026, 0, 5);
    const fri = new Date(2026, 0, 2);
    expect(isWeekend(mon)).toBe(false);
    expect(isWeekend(fri)).toBe(false);
  });
});

describe('computeOrderAmount', () => {
  test('sums cantidad × precioUnitario for each item', () => {
    const params = {
      items: [
        { cantidad: 10, precioUnitario: 25 },   // 250
        { cantidad: 2,  precioUnitario: 100 },  // 200
      ],
    };
    expect(computeOrderAmount(params)).toBe(450);
  });

  test('treats missing numeric fields as 0', () => {
    expect(computeOrderAmount({ items: [{}] })).toBe(0);
    expect(computeOrderAmount({ items: [{ cantidad: 'x', precioUnitario: 'y' }] })).toBe(0);
  });

  test('returns 0 when items is missing or non-array', () => {
    expect(computeOrderAmount(null)).toBe(0);
    expect(computeOrderAmount({})).toBe(0);
    expect(computeOrderAmount({ items: 'not-array' })).toBe(0);
  });
});

describe('validateGuardrails — session and synchronous checks (no fincaId)', () => {
  // No fincaId → global (DB-backed) checks are skipped. Perfect for unit tests.
  const baseCtx = { sessionExecutedCount: 0 };

  test('allows when under all limits', async () => {
    const res = await validateGuardrails('crear_tarea', {}, {}, baseCtx);
    expect(res.allowed).toBe(true);
    expect(res.violations).toEqual([]);
  });

  test('blocks when sessionExecutedCount reaches maxActionsPerSession', async () => {
    const res = await validateGuardrails('crear_tarea', {}, {}, {
      sessionExecutedCount: DEFAULTS.maxActionsPerSession,
    });
    expect(res.allowed).toBe(false);
    expect(res.violations[0]).toMatch(/acciones autónomas por sesión/i);
  });

  test('blocks when actionType not in allowedActionTypes', async () => {
    const res = await validateGuardrails('enviar_notificacion', {}, {
      allowedActionTypes: ['crear_tarea'],
    }, baseCtx);
    expect(res.allowed).toBe(false);
    expect(res.violations[0]).toMatch(/no está habilitado/);
  });

  test('blocks when loteId is in blockedLotes', async () => {
    const res = await validateGuardrails('crear_tarea', { loteId: 'abc' }, {
      blockedLotes: ['abc', 'def'],
    }, baseCtx);
    expect(res.allowed).toBe(false);
    expect(res.violations[0]).toMatch(/lote está bloqueado/);
  });

  test('blocks ajustar_inventario when % change exceeds limit', async () => {
    const res = await validateGuardrails('ajustar_inventario', {
      stockActual: 100,
      stockNuevo: 200, // 100% change
    }, { maxStockAdjustPercent: 30 }, baseCtx);
    expect(res.allowed).toBe(false);
    expect(res.violations[0]).toMatch(/Cambio de stock/);
  });

  test('allows ajustar_inventario under % change limit', async () => {
    const res = await validateGuardrails('ajustar_inventario', {
      stockActual: 100,
      stockNuevo: 120, // 20% change
    }, { maxStockAdjustPercent: 30 }, baseCtx);
    expect(res.allowed).toBe(true);
  });

  test('blocks single-OC amount when over maxOrdenCompraMonto', async () => {
    const res = await validateGuardrails('crear_orden_compra', {
      items: [{ cantidad: 100, precioUnitario: 60 }], // 6000
    }, { maxOrdenCompraMonto: 5000 }, baseCtx);
    expect(res.allowed).toBe(false);
    expect(res.violations[0]).toMatch(/excede el límite de \$5000/);
  });

  test('blocks action type during quiet hours when enforced', async () => {
    // Quiet hours 00:00–23:59 essentially always blocks; pass `now` explicitly
    // so the test doesn't depend on server wall clock.
    const res = await validateGuardrails('enviar_notificacion', {}, {
      quietHours: { start: '00:00', end: '23:59' },
    }, { ...baseCtx, now: new Date(2026, 0, 1, 12, 0) });
    expect(res.allowed).toBe(false);
    expect(res.violations[0]).toMatch(/horario silencioso/);
  });

  test('quiet hours default enforcement list is [enviar_notificacion]', async () => {
    const guardrails = { quietHours: { start: '00:00', end: '23:59' } };
    const ctx = { ...baseCtx, now: new Date(2026, 0, 1, 12, 0) };
    const notif = await validateGuardrails('enviar_notificacion', {}, guardrails, ctx);
    const tarea = await validateGuardrails('crear_tarea', {}, guardrails, ctx);
    expect(notif.allowed).toBe(false);
    expect(tarea.allowed).toBe(true);
  });

  test('weekendActions=false blocks on Sat/Sun', async () => {
    const saturday = new Date(2026, 0, 3, 10, 0);
    const monday   = new Date(2026, 0, 5, 10, 0);
    const guardrails = { weekendActions: false };
    const satRes = await validateGuardrails('crear_tarea', {}, guardrails, { ...baseCtx, now: saturday });
    const monRes = await validateGuardrails('crear_tarea', {}, guardrails, { ...baseCtx, now: monday });
    expect(satRes.allowed).toBe(false);
    expect(monRes.allowed).toBe(true);
  });
});

describe('validateGuardrails — HR domain (sub-fase 3.0)', () => {
  const baseCtx = { sessionExecutedCount: 0 };

  test('blocks HR action when rrhh kill switch is off', async () => {
    const res = await validateGuardrails('sugerir_contratacion', {}, {
      dominios: { rrhh: { activo: false } },
    }, baseCtx);
    expect(res.allowed).toBe(false);
    expect(res.violationsByCategory.hr).toEqual(
      expect.arrayContaining([expect.stringMatching(/kill switch/i)])
    );
  });

  test('blocks every FORBIDDEN_AT_NIVEL3 HR action regardless of config', async () => {
    const types = [
      'sugerir_contratacion',
      'sugerir_despido',
      'sugerir_sancion',
      'sugerir_memorando',
      'sugerir_revision_desempeno',
    ];
    for (const t of types) {
      const res = await validateGuardrails(t, {}, {}, baseCtx);
      expect(res.allowed).toBe(false);
      expect(res.violationsByCategory.hr).toEqual(
        expect.arrayContaining([expect.stringMatching(/revisión humana/i)])
      );
    }
  });

  test('non-HR actions are unaffected by rrhh kill switch', async () => {
    const res = await validateGuardrails('crear_tarea', {}, {
      dominios: { rrhh: { activo: false } },
    }, baseCtx);
    expect(res.allowed).toBe(true);
  });

  test('HR action kill switch + cap produce two distinct violations', async () => {
    const res = await validateGuardrails('sugerir_contratacion', {}, {
      dominios: { rrhh: { activo: false } },
    }, baseCtx);
    expect(res.violationsByCategory.hr.length).toBe(2);
  });
});
