// Pure weekly-consumption stats derived from `movimientos`.
//
// Consumption in Aurora is recorded when an `aplicacion` task is marked
// `completed_by_user`: tasks.js writes one `movimientos` doc per product with
// `tipo: 'egreso'`. This lib aggregates that stream into a per-product weekly
// average, bounded to a configurable lookback window.
//
// The denominator is the effective window — from the product's first observed
// movement (or the cutoff, whichever is later) to `now` — so products that
// only started being consumed mid-window are not underestimated 8x.

const MS_PER_DAY = 86400000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function weeklyConsumptionByProduct(movimientos, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const lookbackWeeks = Math.max(1, Number(opts.lookbackWeeks) || 8);
  const tipo = opts.tipo || 'egreso';
  const cutoff = new Date(now.getTime() - lookbackWeeks * MS_PER_WEEK);

  const byProduct = new Map();
  for (const m of movimientos || []) {
    if (!m || m.tipo !== tipo) continue;
    const fecha = toDate(m.fecha);
    if (!fecha || fecha < cutoff) continue;
    const qty = Number(m.cantidad);
    if (!(qty > 0)) continue;
    const pid = m.productoId;
    if (!pid) continue;
    const bucket = byProduct.get(pid) || { total: 0, samples: 0, first: fecha, last: fecha };
    bucket.total += qty;
    bucket.samples += 1;
    if (fecha < bucket.first) bucket.first = fecha;
    if (fecha > bucket.last) bucket.last = fecha;
    byProduct.set(pid, bucket);
  }

  const out = {};
  for (const [pid, b] of byProduct) {
    const elapsedWeeks = Math.max(1 / 7, (now - b.first) / MS_PER_WEEK);
    const denominator = Math.min(lookbackWeeks, elapsedWeeks);
    out[pid] = {
      weeklyAvg: round4(b.total / denominator),
      totalInWindow: round4(b.total),
      sampleCount: b.samples,
      firstDate: b.first,
      lastDate: b.last,
    };
  }
  return out;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function round4(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

module.exports = {
  weeklyConsumptionByProduct,
};
