// Inferencia de temporadas a partir de registros de cosecha.
//
// Función pura: no toca Firestore. Recibe los registros ya materializados y
// devuelve propuestas de temporada ordenadas cronológicamente. El consumidor
// decide si persistirlas (POST /api/analytics/temporadas) o descartarlas.
//
// Heurística:
//   1. Filtra registros con `fecha` válido (YYYY-MM-DD) y `cantidad > 0`.
//   2. Ordena por fecha ascendente.
//   3. Recorre la secuencia; cuando el hueco entre dos cosechas consecutivas
//      es ≥ `gapDays`, cierra la temporada actual y abre una nueva.
//   4. Descarta clusters con menos de `minRecords` o con duración (fin-inicio)
//      menor a `minLengthDays`.
//   5. Nombra cada temporada `YYYY-A/B/C…` según el año de inicio y el índice
//      dentro de ese año.
//
// Decisiones explícitas:
//   - Las fechas se comparan como strings (YYYY-MM-DD), que ordena
//     lexicográficamente igual que cronológicamente.
//   - La diferencia en días se calcula con UTC para evitar DST.
//   - La heurística es intencionalmente conservadora: prefiere dejar registros
//     fuera a mezclar dos temporadas. El usuario puede editar los rangos.

const DEFAULTS = Object.freeze({
  gapDays: 30,
  minLengthDays: 45,
  minRecords: 3,
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function daysBetween(isoA, isoB) {
  const a = Date.UTC(...isoA.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n)));
  const b = Date.UTC(...isoB.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n)));
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function toSequenceLetter(index) {
  // 0 → A, 1 → B, … 25 → Z, 26 → AA, 27 → AB, etc. Poco probable pasar de Z
  // en la práctica (3-4 temporadas/año es lo común), pero el código lo tolera.
  if (index < 26) return String.fromCharCode(65 + index);
  const first = Math.floor(index / 26) - 1;
  const second = index % 26;
  return String.fromCharCode(65 + first) + String.fromCharCode(65 + second);
}

function inferSeasons(cosechaRecords, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  if (!Array.isArray(cosechaRecords) || cosechaRecords.length === 0) return [];

  const valid = [];
  for (const rec of cosechaRecords) {
    if (!rec || !isValidIsoDate(rec.fecha)) continue;
    const kg = Number(rec.cantidad) || 0;
    if (kg <= 0) continue;
    valid.push({ fecha: rec.fecha, kg });
  }
  if (valid.length === 0) return [];

  valid.sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Cortamos en clusters cuando aparece un hueco >= gapDays.
  const clusters = [];
  let current = { registros: [valid[0]] };
  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1];
    const next = valid[i];
    if (daysBetween(prev.fecha, next.fecha) >= opts.gapDays) {
      clusters.push(current);
      current = { registros: [next] };
    } else {
      current.registros.push(next);
    }
  }
  clusters.push(current);

  // Aplicamos filtros de tamaño y nombramos.
  const yearCounters = {};
  const out = [];
  for (const cluster of clusters) {
    const recs = cluster.registros;
    if (recs.length < opts.minRecords) continue;
    const fechaInicio = recs[0].fecha;
    const fechaFin = recs[recs.length - 1].fecha;
    if (daysBetween(fechaInicio, fechaFin) < opts.minLengthDays) continue;
    const totalKg = recs.reduce((s, r) => s + r.kg, 0);
    const year = fechaInicio.slice(0, 4);
    yearCounters[year] = (yearCounters[year] || 0) + 1;
    const nombre = `${year}-${toSequenceLetter(yearCounters[year] - 1)}`;
    out.push({
      nombre,
      fechaInicio,
      fechaFin,
      autoDetected: true,
      nRegistros: recs.length,
      totalKg: parseFloat(totalKg.toFixed(2)),
    });
  }
  return out;
}

module.exports = {
  inferSeasons,
  // Helpers exportados para tests unitarios.
  _isValidIsoDate: isValidIsoDate,
  _daysBetween: daysBetween,
  _toSequenceLetter: toSequenceLetter,
  DEFAULTS,
};
