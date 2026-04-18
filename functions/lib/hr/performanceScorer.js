// Monthly worker performance scorer — pure.
//
// Takes fully-materialized inputs (tasks, horimetro rows, attendance,
// leaves, ficha) and produces a 0..100 score broken down into
// subscores. No Firestore here — that's the aggregator's job.
//
// Design choices driven by the Phase 3 plan:
//   - Weights default: completion 0.4 / punctuality 0.25 / attendance 0.25 / machine 0.1
//   - machineUtilization is null (and excluded from the weighted sum)
//     when the worker has no hr_fichas entry or no horimetro activity
//   - lowConfidence = true when fewer than 5 tasks were assigned in
//     the period. The output still carries a score for transparency,
//     but callers should suppress downstream actions (alerts, rankings)
//     when this flag is set
//   - Attendance counts approved leaves with conGoce=true as present

const DEFAULT_WEIGHTS = Object.freeze({
  completion: 0.4,
  punctuality: 0.25,
  attendance: 0.25,
  machine: 0.1,
});

const LOW_CONFIDENCE_THRESHOLD = 5;
const PUNCTUALITY_MAX_LATE_HOURS = 48;
const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// ── Helpers ───────────────────────────────────────────────────────────────

function toMillis(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function parseHHMM(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h + mi / 60;
}

// ── Subscorers ────────────────────────────────────────────────────────────

// completionRate: of the tasks assigned to the worker within the period,
// how many transitioned to completed_by_user?
//
//   denominator = completed + skipped + overdue(pending)
//   overdue(pending) = status === 'pending' && executeAt < periodEnd
//
// Tasks that are still pending but not yet overdue are excluded from
// both sides — they haven't had their chance to be completed yet.
function computeCompletionRate(tasks, periodEndMs) {
  let completed = 0;
  let penalized = 0;
  let assigned = 0;
  for (const t of tasks) {
    const status = t.status;
    if (status === 'completed_by_user') {
      completed += 1;
      penalized += 1;
      assigned += 1;
      continue;
    }
    if (status === 'skipped') {
      penalized += 1;
      assigned += 1;
      continue;
    }
    if (status === 'pending') {
      const ms = toMillis(t.executeAt);
      if (ms != null && ms < periodEndMs) {
        penalized += 1;
        assigned += 1;
      }
    }
  }
  if (penalized === 0) return { score: null, assigned: 0 };
  return { score: (completed / penalized) * 100, assigned };
}

// punctuality: for each completed task, compute hours between completedAt
// and executeAt. Hours ≤ 0 score 100 (early or on time). Scale linearly to
// 0 at PUNCTUALITY_MAX_LATE_HOURS late. Average across completed tasks.
function computePunctuality(tasks) {
  let sum = 0;
  let n = 0;
  for (const t of tasks) {
    if (t.status !== 'completed_by_user') continue;
    const execMs = toMillis(t.executeAt);
    const doneMs = toMillis(t.completedAt);
    if (execMs == null || doneMs == null) continue;
    const lateHours = Math.max(0, (doneMs - execMs) / 3_600_000);
    const taskScore = clamp(100 - (lateHours / PUNCTUALITY_MAX_LATE_HOURS) * 100, 0, 100);
    sum += taskScore;
    n += 1;
  }
  if (n === 0) return { score: null, samples: 0 };
  return { score: sum / n, samples: n };
}

// machineUtilization: ratio of logged machinery hours to the expected
// work hours implied by the ficha.horasSemanales for the period.
//
// Null when the worker doesn't operate machinery (no horimetro rows),
// or has no ficha / no weekly-hours info.
function computeMachineUtilization(horimetroRows, fichaWeeklyHours, periodStartMs, periodEndMs) {
  if (!Array.isArray(horimetroRows) || horimetroRows.length === 0) {
    return { score: null, actualHours: 0 };
  }
  if (!Number.isFinite(fichaWeeklyHours) || fichaWeeklyHours <= 0) {
    return { score: null, actualHours: 0 };
  }

  let actualHours = 0;
  for (const row of horimetroRows) {
    const startH = parseHHMM(row.horaInicio);
    const endH = parseHHMM(row.horaFinal);
    if (startH == null || endH == null) continue;
    let diff = endH - startH;
    if (row.diaSiguiente === true) diff += 24;
    if (diff > 0) actualHours += diff;
  }

  const weeksInPeriod = (periodEndMs - periodStartMs) / (7 * 24 * 3_600_000);
  const expectedHours = fichaWeeklyHours * Math.max(weeksInPeriod, 0);
  if (expectedHours <= 0) return { score: null, actualHours };
  const ratio = actualHours / expectedHours;
  return { score: clamp(ratio * 100, 0, 100), actualHours };
}

// attendance: presentDays / scheduledDays. Approved leaves with conGoce=true
// count as present (excused). scheduledDays derives from ficha.horarioSemanal.
function computeAttendance(asistencia, permisos, horarioSemanal, periodStartMs, periodEndMs) {
  const scheduledDaySet = new Set();
  if (horarioSemanal && typeof horarioSemanal === 'object') {
    for (const name of DAY_NAMES_ES) {
      if (horarioSemanal[name]?.activo) scheduledDaySet.add(name);
    }
  }
  if (scheduledDaySet.size === 0) return { score: null, scheduledDays: 0, presentDays: 0 };

  let scheduledDays = 0;
  const dayMs = 24 * 3_600_000;
  for (let t = periodStartMs; t < periodEndMs; t += dayMs) {
    const day = new Date(t);
    const name = DAY_NAMES_ES[day.getDay()];
    if (scheduledDaySet.has(name)) scheduledDays += 1;
  }
  if (scheduledDays === 0) return { score: null, scheduledDays: 0, presentDays: 0 };

  const presentDates = new Set();
  for (const a of asistencia) {
    if (a.estado !== 'presente') continue;
    const ms = toMillis(a.fecha);
    if (ms == null || ms < periodStartMs || ms >= periodEndMs) continue;
    presentDates.add(new Date(ms).toISOString().slice(0, 10));
  }
  for (const p of permisos) {
    if (p.estado !== 'aprobado' || p.conGoce !== true) continue;
    const startMs = toMillis(p.fechaInicio);
    const endMs = toMillis(p.fechaFin);
    if (startMs == null || endMs == null) continue;
    const from = Math.max(startMs, periodStartMs);
    const to = Math.min(endMs, periodEndMs - 1);
    for (let t = from; t <= to; t += dayMs) {
      presentDates.add(new Date(t).toISOString().slice(0, 10));
    }
  }

  const presentDays = presentDates.size;
  return { score: clamp((presentDays / scheduledDays) * 100, 0, 100), scheduledDays, presentDays };
}

// ── Main entry point ──────────────────────────────────────────────────────

function scoreWorkerMonth(input) {
  const {
    userId,
    tasks = [],
    horimetroRows = [],
    asistencia = [],
    permisos = [],
    ficha = null,
    periodStart,
    periodEnd,
    opts = {},
  } = input;

  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const periodStartMs = toMillis(periodStart);
  const periodEndMs = toMillis(periodEnd);
  if (periodStartMs == null || periodEndMs == null || periodEndMs <= periodStartMs) {
    throw new Error('scoreWorkerMonth: invalid period (periodStart/periodEnd).');
  }

  const period = new Date(periodStartMs).toISOString().slice(0, 7);
  const fichaWeeklyHours = Number(ficha?.horasSemanales) || 0;

  const completion = computeCompletionRate(tasks, periodEndMs);
  const punctuality = computePunctuality(tasks);
  const machine = computeMachineUtilization(horimetroRows, fichaWeeklyHours, periodStartMs, periodEndMs);
  const attendance = computeAttendance(asistencia, permisos, ficha?.horarioSemanal, periodStartMs, periodEndMs);

  // Weighted sum. Null subscores are skipped and their weight gets
  // redistributed proportionally across the remaining weights. If every
  // subscore is null the overall score is 0 with lowConfidence=true.
  const parts = [
    { key: 'completion', value: completion.score, weight: weights.completion },
    { key: 'punctuality', value: punctuality.score, weight: weights.punctuality },
    { key: 'attendance', value: attendance.score, weight: weights.attendance },
    { key: 'machine', value: machine.score, weight: weights.machine },
  ];
  const active = parts.filter(p => p.value != null && Number.isFinite(p.value));
  const activeWeightSum = active.reduce((s, p) => s + p.weight, 0);
  let score = 0;
  if (activeWeightSum > 0) {
    score = active.reduce((s, p) => s + (p.value * p.weight) / activeWeightSum, 0);
  }

  const sampleSize = completion.assigned;
  const lowConfidence = sampleSize < (opts.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD);

  return {
    userId,
    period,
    score: Math.round(clamp(score, 0, 100) * 10) / 10,
    subscores: {
      completionRate: roundOrNull(completion.score),
      punctuality: roundOrNull(punctuality.score),
      machineUtilization: roundOrNull(machine.score),
      attendance: roundOrNull(attendance.score),
    },
    weights,
    sampleSize,
    lowConfidence,
    details: {
      presentDays: attendance.presentDays,
      scheduledDays: attendance.scheduledDays,
      machineHours: Math.round(machine.actualHours * 10) / 10,
      punctualityObservations: punctuality.samples,
    },
  };
}

function roundOrNull(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 10) / 10;
}

module.exports = {
  scoreWorkerMonth,
  DEFAULT_WEIGHTS,
  LOW_CONFIDENCE_THRESHOLD,
  // Exposed for tests
  computeCompletionRate,
  computePunctuality,
  computeMachineUtilization,
  computeAttendance,
};
