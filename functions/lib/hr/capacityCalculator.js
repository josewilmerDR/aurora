// Capacity calculator — pure.
//
// Given a set of hr_fichas, returns the total weekly labor capacity
// available from permanent workers. The per-ficha derivation mirrors
// the formula already used by the planilla-fijo handler in hr.js
// (summing the duration of each active day in horarioSemanal).
//
// Only permanent contracts count toward baseline capacity. Temporal
// and por_obra contracts are surplus — the workload projector can
// optionally incorporate them as "additional capacity" but never as
// the denominator for "do I have enough people?".

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DEFAULT_FALLBACK_WEEKLY_HOURS = 40;
const MAX_WEEKLY_HOURS = 168; // 7 * 24

function parseHHMM(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

// Returns a worker's weekly hours derived from their horarioSemanal.
// Falls back to DEFAULT_FALLBACK_WEEKLY_HOURS when horarioSemanal is
// absent or has no active days — same behavior as the payroll path.
function weeklyHoursFromHorario(horarioSemanal) {
  if (!horarioSemanal || typeof horarioSemanal !== 'object') {
    return DEFAULT_FALLBACK_WEEKLY_HOURS;
  }
  let total = 0;
  for (const day of DIAS) {
    const d = horarioSemanal[day];
    if (!d?.activo) continue;
    const start = parseHHMM(d.inicio);
    const end = parseHHMM(d.fin);
    if (start == null || end == null) continue;
    const diff = Math.max(0, end - start) / 60;
    total += diff;
  }
  if (total <= 0) return DEFAULT_FALLBACK_WEEKLY_HOURS;
  return Math.min(total, MAX_WEEKLY_HOURS);
}

// Aggregates capacity across fichas. Permanent contracts form the
// baseline; temporal and por_obra are returned separately for
// transparency but never folded into `baseline`.
function currentCapacity(fichas) {
  const safeFichas = Array.isArray(fichas) ? fichas : [];
  const permanentWorkers = [];
  const temporalWorkers = [];
  let baselineHours = 0;
  let surplusHours = 0;

  for (const f of safeFichas) {
    if (!f) continue;
    const hours = weeklyHoursFromHorario(f.horarioSemanal);
    const entry = {
      userId: f.userId || f.id || null,
      weeklyHours: Math.round(hours * 10) / 10,
      tipoContrato: f.tipoContrato || 'unknown',
    };
    if (f.tipoContrato === 'permanente') {
      baselineHours += hours;
      permanentWorkers.push(entry);
    } else if (f.tipoContrato === 'temporal' || f.tipoContrato === 'por_obra') {
      surplusHours += hours;
      temporalWorkers.push(entry);
    }
  }

  const baselineCount = permanentWorkers.length;
  const avgWeeklyHoursPermanent = baselineCount > 0
    ? baselineHours / baselineCount
    : DEFAULT_FALLBACK_WEEKLY_HOURS;

  return {
    baselineWeeklyHours: Math.round(baselineHours * 10) / 10,
    surplusWeeklyHours: Math.round(surplusHours * 10) / 10,
    permanentCount: baselineCount,
    temporalCount: temporalWorkers.length,
    avgWeeklyHoursPermanent: Math.round(avgWeeklyHoursPermanent * 10) / 10,
    permanentWorkers,
    temporalWorkers,
  };
}

module.exports = {
  currentCapacity,
  weeklyHoursFromHorario,
  DEFAULT_FALLBACK_WEEKLY_HOURS,
  MAX_WEEKLY_HOURS,
};
