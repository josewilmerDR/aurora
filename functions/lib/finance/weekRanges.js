// Generación de rangos semanales (lunes–domingo) a partir de una fecha ISO.
// Pura, sin dependencias.

function parseISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

function toISO(dt) {
  return dt.toISOString().slice(0, 10);
}

// Lunes de la semana ISO que contiene `dt`.
function mondayOf(dt) {
  const out = new Date(dt.getTime());
  const dow = out.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  out.setUTCDate(out.getUTCDate() + diff);
  return out;
}

function addDays(dt, days) {
  const out = new Date(dt.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

// Genera `weeks` semanas lunes–domingo a partir de la semana que contiene
// `startDateISO`. La primera semana puede ser parcial: su `weekStart` se
// recorta a `startDateISO` (no al lunes anterior), pero su `weekEnd` siempre
// es el domingo natural de esa semana. Esto permite alinear la salida con
// semanas ISO mientras se respeta el hecho de que el saldo inicial cuenta
// desde el día real, no desde el lunes anterior.
function buildWeekRanges(startDateISO, weeks) {
  const start = parseISO(startDateISO);
  if (!start) return [];
  const w = Number(weeks);
  if (!Number.isFinite(w) || w <= 0) return [];

  const ranges = [];
  const firstMonday = mondayOf(start);
  for (let i = 0; i < w; i++) {
    const monday = addDays(firstMonday, i * 7);
    const sunday = addDays(monday, 6);
    const weekStart = i === 0 && start > monday ? start : monday;
    ranges.push({ weekStart: toISO(weekStart), weekEnd: toISO(sunday) });
  }
  return ranges;
}

// Devuelve true si fechaISO cae dentro del rango [from, to] (inclusive ambos).
function isInWeek(fechaISO, range) {
  return typeof fechaISO === 'string'
    && fechaISO >= range.weekStart
    && fechaISO <= range.weekEnd;
}

module.exports = {
  buildWeekRanges,
  isInWeek,
  parseISO,
  toISO,
  addDays,
};
