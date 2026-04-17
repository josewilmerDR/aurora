// Conversión pura de "period string" → rango ISO YYYY-MM-DD.
// Formatos soportados:
//   - "2026"       → año completo
//   - "2026-Q1"    → trimestre (Q1..Q4)
//   - "2026-04"    → mes

const YEAR_RE    = /^\d{4}$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const MONTH_RE   = /^(\d{4})-(0[1-9]|1[0-2])$/;

// Último día del mes en UTC. Dejamos que Date normalice "día 0 del mes N+1".
function lastDayOfMonth(year, monthZeroIdx) {
  return new Date(Date.UTC(year, monthZeroIdx + 1, 0)).getUTCDate();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Devuelve { from, to } en formato YYYY-MM-DD, o null si el string no es válido.
function periodToDateRange(period) {
  if (typeof period !== 'string') return null;

  const mYear = period.match(YEAR_RE);
  if (mYear) {
    const y = period;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }

  const mQuarter = period.match(QUARTER_RE);
  if (mQuarter) {
    const year = Number(mQuarter[1]);
    const q = Number(mQuarter[2]);
    const startMonth = (q - 1) * 3;
    const endMonth = startMonth + 2;
    const last = lastDayOfMonth(year, endMonth);
    return {
      from: `${year}-${pad2(startMonth + 1)}-01`,
      to:   `${year}-${pad2(endMonth + 1)}-${pad2(last)}`,
    };
  }

  const mMonth = period.match(MONTH_RE);
  if (mMonth) {
    const year = Number(mMonth[1]);
    const month = Number(mMonth[2]);
    const last = lastDayOfMonth(year, month - 1);
    return {
      from: `${year}-${pad2(month)}-01`,
      to:   `${year}-${pad2(month)}-${pad2(last)}`,
    };
  }

  return null;
}

function isValidPeriod(period) {
  return periodToDateRange(period) !== null;
}

module.exports = {
  periodToDateRange,
  isValidPeriod,
};
