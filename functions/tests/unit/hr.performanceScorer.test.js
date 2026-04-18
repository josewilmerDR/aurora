// Unit tests for performanceScorer. Pure — no Firestore.

const {
  scoreWorkerMonth,
  DEFAULT_WEIGHTS,
  LOW_CONFIDENCE_THRESHOLD,
  computeCompletionRate,
  computePunctuality,
  computeMachineUtilization,
  computeAttendance,
} = require('../../lib/hr/performanceScorer');

// All tests use the same Apr-2026 window unless stated otherwise.
const periodStart = new Date('2026-04-01T00:00:00Z');
const periodEnd = new Date('2026-05-01T00:00:00Z');

// Ficha con 5 días activos lunes..viernes de 8h → 40h semanales.
const FULL_WEEK_FICHA = {
  horasSemanales: 40,
  horarioSemanal: {
    lunes: { activo: true, inicio: '07:00', fin: '15:00' },
    martes: { activo: true, inicio: '07:00', fin: '15:00' },
    miercoles: { activo: true, inicio: '07:00', fin: '15:00' },
    jueves: { activo: true, inicio: '07:00', fin: '15:00' },
    viernes: { activo: true, inicio: '07:00', fin: '15:00' },
    sabado: { activo: false },
    domingo: { activo: false },
  },
};

function taskDoc({ status, executeAt, completedAt }) {
  return { status, executeAt, completedAt };
}

// ── computeCompletionRate ─────────────────────────────────────────────────

describe('computeCompletionRate', () => {
  const end = periodEnd.getTime();

  test('returns null when no tasks are penalized', () => {
    const out = computeCompletionRate([], end);
    expect(out.score).toBeNull();
    expect(out.assigned).toBe(0);
  });

  test('all completed → 100, sampleSize counts each assigned', () => {
    const tasks = [
      taskDoc({ status: 'completed_by_user' }),
      taskDoc({ status: 'completed_by_user' }),
    ];
    const out = computeCompletionRate(tasks, end);
    expect(out.score).toBe(100);
    expect(out.assigned).toBe(2);
  });

  test('skipped and overdue both lower the rate', () => {
    const overdue = taskDoc({ status: 'pending', executeAt: new Date('2026-04-15') });
    const tasks = [
      taskDoc({ status: 'completed_by_user' }),
      taskDoc({ status: 'skipped' }),
      overdue,
    ];
    const out = computeCompletionRate(tasks, end);
    expect(out.score).toBeCloseTo(100 / 3, 1);
    expect(out.assigned).toBe(3);
  });

  test('pending tasks not yet overdue are excluded from the denominator', () => {
    const notYet = taskDoc({ status: 'pending', executeAt: new Date('2026-05-20') });
    const done = taskDoc({ status: 'completed_by_user' });
    const out = computeCompletionRate([notYet, done], end);
    expect(out.score).toBe(100);
    expect(out.assigned).toBe(1);
  });
});

// ── computePunctuality ───────────────────────────────────────────────────

describe('computePunctuality', () => {
  test('returns null when no completed tasks', () => {
    const out = computePunctuality([taskDoc({ status: 'pending' })]);
    expect(out.score).toBeNull();
    expect(out.samples).toBe(0);
  });

  test('on-time tasks score 100', () => {
    const t = taskDoc({
      status: 'completed_by_user',
      executeAt: new Date('2026-04-10T10:00:00Z'),
      completedAt: new Date('2026-04-10T10:00:00Z'),
    });
    expect(computePunctuality([t]).score).toBe(100);
  });

  test('early completion also scores 100', () => {
    const t = taskDoc({
      status: 'completed_by_user',
      executeAt: new Date('2026-04-10T10:00:00Z'),
      completedAt: new Date('2026-04-10T09:00:00Z'),
    });
    expect(computePunctuality([t]).score).toBe(100);
  });

  test('24h late scores 50 (half of the 48h window)', () => {
    const t = taskDoc({
      status: 'completed_by_user',
      executeAt: new Date('2026-04-10T10:00:00Z'),
      completedAt: new Date('2026-04-11T10:00:00Z'),
    });
    expect(computePunctuality([t]).score).toBe(50);
  });

  test('very late (> 48h) bottoms out at 0', () => {
    const t = taskDoc({
      status: 'completed_by_user',
      executeAt: new Date('2026-04-10T10:00:00Z'),
      completedAt: new Date('2026-04-20T10:00:00Z'),
    });
    expect(computePunctuality([t]).score).toBe(0);
  });

  test('skips completed tasks missing either timestamp', () => {
    const t = taskDoc({ status: 'completed_by_user', executeAt: new Date('2026-04-10') });
    expect(computePunctuality([t]).samples).toBe(0);
  });
});

// ── computeMachineUtilization ────────────────────────────────────────────

describe('computeMachineUtilization', () => {
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();

  test('null when no horimetro rows', () => {
    const out = computeMachineUtilization([], 40, startMs, endMs);
    expect(out.score).toBeNull();
  });

  test('null when ficha has no weekly hours', () => {
    const rows = [{ horaInicio: '08:00', horaFinal: '16:00' }];
    const out = computeMachineUtilization(rows, 0, startMs, endMs);
    expect(out.score).toBeNull();
  });

  test('half the expected hours → score 50', () => {
    // April 2026 ≈ 4.29 weeks × 40h = ~171.4 expected. Log ~85.7h of machinery.
    const rows = Array.from({ length: 11 }, () => ({ horaInicio: '07:00', horaFinal: '15:00' }));
    const out = computeMachineUtilization(rows, 40, startMs, endMs);
    expect(out.score).toBeGreaterThan(45);
    expect(out.score).toBeLessThan(55);
  });

  test('overnight shift via diaSiguiente is handled', () => {
    const rows = [{ horaInicio: '22:00', horaFinal: '06:00', diaSiguiente: true }];
    const out = computeMachineUtilization(rows, 40, startMs, endMs);
    // 8 hours logged / ~171 expected ≈ 4.6 score
    expect(out.actualHours).toBe(8);
  });

  test('skips rows with invalid times', () => {
    const rows = [{ horaInicio: 'bad', horaFinal: 'worse' }];
    const out = computeMachineUtilization(rows, 40, startMs, endMs);
    expect(out.score).toBe(0);
  });
});

// ── computeAttendance ────────────────────────────────────────────────────

describe('computeAttendance', () => {
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();

  test('null when horario has no active days', () => {
    const out = computeAttendance([], [], { lunes: { activo: false } }, startMs, endMs);
    expect(out.score).toBeNull();
  });

  test('100 when every scheduled day has a "presente" record', () => {
    const scheduled = [];
    for (let d = 1; d <= 30; d++) {
      const dt = new Date(Date.UTC(2026, 3, d));
      if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
      scheduled.push({ estado: 'presente', fecha: dt });
    }
    const out = computeAttendance(scheduled, [], FULL_WEEK_FICHA.horarioSemanal, startMs, endMs);
    expect(out.score).toBe(100);
    expect(out.scheduledDays).toBe(scheduled.length);
  });

  test('approved paid leave counts as present', () => {
    const leave = {
      estado: 'aprobado',
      conGoce: true,
      fechaInicio: new Date('2026-04-06T12:00:00Z'),
      fechaFin: new Date('2026-04-10T12:00:00Z'),
    };
    const out = computeAttendance([], [leave], FULL_WEEK_FICHA.horarioSemanal, startMs, endMs);
    // 5 days counted as present out of 22 scheduled weekdays in April 2026
    expect(out.presentDays).toBe(5);
  });

  test('unpaid or pending leave does not count', () => {
    const unpaid = { estado: 'aprobado', conGoce: false, fechaInicio: new Date('2026-04-06'), fechaFin: new Date('2026-04-10') };
    const pending = { estado: 'pendiente', conGoce: true, fechaInicio: new Date('2026-04-06'), fechaFin: new Date('2026-04-10') };
    const out = computeAttendance([], [unpaid, pending], FULL_WEEK_FICHA.horarioSemanal, startMs, endMs);
    expect(out.presentDays).toBe(0);
  });
});

// ── scoreWorkerMonth — end-to-end ────────────────────────────────────────

describe('scoreWorkerMonth', () => {
  test('sampleSize < threshold flips lowConfidence regardless of score', () => {
    const out = scoreWorkerMonth({
      userId: 'u1',
      tasks: [
        taskDoc({ status: 'completed_by_user', executeAt: new Date('2026-04-10'), completedAt: new Date('2026-04-10') }),
      ],
      ficha: FULL_WEEK_FICHA,
      periodStart,
      periodEnd,
    });
    expect(out.lowConfidence).toBe(true);
    expect(out.sampleSize).toBe(1);
  });

  test('sampleSize at threshold is NOT low confidence', () => {
    const tasks = [];
    for (let i = 0; i < LOW_CONFIDENCE_THRESHOLD; i++) {
      tasks.push(taskDoc({
        status: 'completed_by_user',
        executeAt: new Date('2026-04-10'),
        completedAt: new Date('2026-04-10'),
      }));
    }
    const out = scoreWorkerMonth({
      userId: 'u1', tasks, ficha: FULL_WEEK_FICHA, periodStart, periodEnd,
    });
    expect(out.lowConfidence).toBe(false);
  });

  test('null subscores are excluded and weights renormalized', () => {
    // Worker with zero horimetro rows → machine subscore null.
    // 8 on-time completed tasks → completion=100, punctuality=100.
    // No attendance records → attendance subscore null.
    const tasks = [];
    for (let i = 0; i < 8; i++) {
      tasks.push(taskDoc({
        status: 'completed_by_user',
        executeAt: new Date('2026-04-10'),
        completedAt: new Date('2026-04-10'),
      }));
    }
    const out = scoreWorkerMonth({
      userId: 'u1', tasks,
      ficha: { horasSemanales: 0, horarioSemanal: { lunes: { activo: false } } },
      periodStart, periodEnd,
    });
    // Only completion + punctuality active, both at 100 → overall 100.
    expect(out.score).toBe(100);
    expect(out.subscores.machineUtilization).toBeNull();
    expect(out.subscores.attendance).toBeNull();
  });

  test('weighted sum uses default weights when no override', () => {
    const tasks = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(taskDoc({
        status: i < 5 ? 'completed_by_user' : 'skipped',
        executeAt: new Date('2026-04-10'),
        completedAt: i < 5 ? new Date('2026-04-10') : null,
      }));
    }
    const out = scoreWorkerMonth({
      userId: 'u1', tasks,
      ficha: { horasSemanales: 0, horarioSemanal: { lunes: { activo: false } } },
      periodStart, periodEnd,
    });
    // completion 50 weight 0.4, punctuality 100 weight 0.25, others null
    // renormalized: 50 * 0.4/0.65 + 100 * 0.25/0.65 ≈ 30.77 + 38.46 = 69.23
    expect(out.score).toBeGreaterThan(68);
    expect(out.score).toBeLessThan(71);
  });

  test('throws on invalid period', () => {
    expect(() => scoreWorkerMonth({
      userId: 'u1', periodStart: periodEnd, periodEnd: periodStart, ficha: {},
    })).toThrow(/invalid period/i);
  });

  test('custom weights override defaults', () => {
    const tasks = [taskDoc({ status: 'completed_by_user', executeAt: new Date('2026-04-10'), completedAt: new Date('2026-04-10') })];
    for (let i = 0; i < 4; i++) tasks.push(taskDoc({ status: 'completed_by_user', executeAt: new Date('2026-04-10'), completedAt: new Date('2026-04-10') }));
    const out = scoreWorkerMonth({
      userId: 'u1', tasks,
      ficha: { horasSemanales: 0, horarioSemanal: { lunes: { activo: false } } },
      periodStart, periodEnd,
      opts: { weights: { completion: 1, punctuality: 0, attendance: 0, machine: 0 } },
    });
    expect(out.weights.completion).toBe(1);
    expect(out.score).toBe(100);
  });

  test('period field is derived from periodStart (YYYY-MM, UTC)', () => {
    const out = scoreWorkerMonth({
      userId: 'u1',
      tasks: [],
      ficha: FULL_WEEK_FICHA,
      periodStart: new Date('2026-04-01T00:00:00Z'),
      periodEnd: new Date('2026-05-01T00:00:00Z'),
    });
    expect(out.period).toBe('2026-04');
  });

  test('default weights frozen and match plan (0.4/0.25/0.25/0.1)', () => {
    expect(Object.isFrozen(DEFAULT_WEIGHTS)).toBe(true);
    expect(DEFAULT_WEIGHTS).toEqual({
      completion: 0.4, punctuality: 0.25, attendance: 0.25, machine: 0.1,
    });
  });
});
