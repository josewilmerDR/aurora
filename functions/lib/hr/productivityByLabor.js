// Productivity matrix builder — pure.
//
// Takes an array of `hr_planilla_unidad` documents and produces a matrix
// of productivity observations bucketed by (userId, labor, loteId,
// unidad). The matrix answers: "when worker X is put on labor Y at lot
// Z using unit U, what's their typical output?"
//
// Design choices:
//   - Keyed by (userId, labor, loteId, UNIDAD). Labors with different
//     units (planta vs hectárea) are NEVER aggregated together. This
//     is non-negotiable: comparing apples to trees produces nonsense
//     and actionable-looking nonsense is worse than no signal.
//   - Rows with samples < minSamplesPerPair are dropped, not emitted
//     with a warning flag. Callers should not have to re-enforce the
//     threshold downstream.
//   - The metric is `avgCantidad` per planilla entry, not per hour.
//     `hr_planilla_unidad` does not track segment-level hours, and
//     inventing a denominator would silently bias the comparison.
//     Downstream consumers can compare avgCantidad within the same
//     (labor, unidad) bucket; cross-bucket comparison is meaningless.

const DEFAULT_MIN_SAMPLES = 3;

function confidenceFromSamples(samples) {
  if (samples >= 10) return 'high';
  if (samples >= 5) return 'medium';
  return 'low';
}

function normalizeString(s) {
  if (typeof s !== 'string') return '';
  return s.trim();
}

function matrixKey(userId, labor, loteId, unidad) {
  return `${userId}|||${labor}|||${loteId || ''}|||${unidad || ''}`;
}

// Iterates the planillas, visiting each (worker × segment) pair exactly
// once. Segments with a zero/negative/missing `cantidad` are skipped —
// they represent workers not assigned to that segment rather than
// workers with zero productivity.
function* iterObservations(planillas) {
  if (!Array.isArray(planillas)) return;
  for (const p of planillas) {
    if (!p || !Array.isArray(p.segmentos) || !Array.isArray(p.trabajadores)) continue;
    const segIndex = new Map();
    for (const s of p.segmentos) {
      if (!s || !s.id) continue;
      segIndex.set(s.id, s);
    }
    for (const w of p.trabajadores) {
      if (!w || !w.trabajadorId) continue;
      const cantidades = w.cantidades || {};
      for (const [segId, rawCantidad] of Object.entries(cantidades)) {
        const cantidad = Number(rawCantidad);
        if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
        const seg = segIndex.get(segId);
        if (!seg) continue;
        const labor = normalizeString(seg.labor);
        if (!labor) continue;
        yield {
          userId: w.trabajadorId,
          labor,
          loteId: normalizeString(seg.loteId) || null,
          unidad: normalizeString(seg.unidad),
          cantidad,
        };
      }
    }
  }
}

function productivityMatrix(planillas, opts = {}) {
  const minSamples = Number.isFinite(opts.minSamplesPerPair)
    ? Math.max(1, Math.floor(opts.minSamplesPerPair))
    : DEFAULT_MIN_SAMPLES;

  const buckets = new Map();
  for (const obs of iterObservations(planillas)) {
    const key = matrixKey(obs.userId, obs.labor, obs.loteId, obs.unidad);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        userId: obs.userId,
        labor: obs.labor,
        loteId: obs.loteId,
        unidad: obs.unidad,
        samples: 0,
        totalCantidad: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.samples += 1;
    bucket.totalCantidad += obs.cantidad;
  }

  const rows = [];
  for (const b of buckets.values()) {
    if (b.samples < minSamples) continue;
    rows.push({
      userId: b.userId,
      labor: b.labor,
      loteId: b.loteId,
      unidad: b.unidad,
      samples: b.samples,
      totalCantidad: Math.round(b.totalCantidad * 100) / 100,
      avgCantidad: Math.round((b.totalCantidad / b.samples) * 100) / 100,
      confidence: confidenceFromSamples(b.samples),
    });
  }

  rows.sort((a, b) => {
    if (a.labor !== b.labor) return a.labor.localeCompare(b.labor);
    if (a.unidad !== b.unidad) return a.unidad.localeCompare(b.unidad);
    return b.avgCantidad - a.avgCantidad;
  });

  return rows;
}

module.exports = {
  productivityMatrix,
  DEFAULT_MIN_SAMPLES,
  // Exposed for tests and for laborBenchmarks consumption
  confidenceFromSamples,
};
