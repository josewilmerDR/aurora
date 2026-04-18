// Unit tests for productivityByLabor. Pure — no Firestore.

const {
  productivityMatrix,
  confidenceFromSamples,
  DEFAULT_MIN_SAMPLES,
} = require('../../lib/hr/productivityByLabor');

// Builds a minimal planilla doc.
function planilla({ segmentos = [], trabajadores = [] } = {}) {
  return { fincaId: 'f1', segmentos, trabajadores };
}

function seg(id, labor, loteId, unidad = 'planta') {
  return { id, labor, loteId, unidad };
}

function worker(userId, cantidades) {
  return { trabajadorId: userId, cantidades };
}

describe('confidenceFromSamples', () => {
  test('tiers', () => {
    expect(confidenceFromSamples(1)).toBe('low');
    expect(confidenceFromSamples(3)).toBe('low');
    expect(confidenceFromSamples(4)).toBe('low');
    expect(confidenceFromSamples(5)).toBe('medium');
    expect(confidenceFromSamples(9)).toBe('medium');
    expect(confidenceFromSamples(10)).toBe('high');
    expect(confidenceFromSamples(50)).toBe('high');
  });
});

describe('productivityMatrix — basic aggregation', () => {
  test('empty input returns empty rows', () => {
    expect(productivityMatrix([])).toEqual([]);
    expect(productivityMatrix(null)).toEqual([]);
  });

  test('drops pairs below minSamplesPerPair (default 3)', () => {
    const p1 = planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a')],
      trabajadores: [worker('u1', { s1: 100 })],
    });
    expect(productivityMatrix([p1])).toEqual([]);
  });

  test('DEFAULT_MIN_SAMPLES is 3 and is what the export says', () => {
    expect(DEFAULT_MIN_SAMPLES).toBe(3);
  });

  test('aggregates same (user, labor, lote, unidad) across planillas', () => {
    const mk = () => planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [worker('u1', { s1: 100 })],
    });
    const rows = productivityMatrix([mk(), mk(), mk()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'u1', labor: 'Deshierva', loteId: 'lote-a', unidad: 'planta',
      samples: 3, totalCantidad: 300, avgCantidad: 100, confidence: 'low',
    });
  });

  test('same labor different unidad buckets separately', () => {
    const p1 = planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [worker('u1', { s1: 100 })],
    });
    const p2 = planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'hectarea')],
      trabajadores: [worker('u1', { s1: 2 })],
    });
    // Need 3 of each to survive the threshold
    const rows = productivityMatrix([p1, p1, p1, p2, p2, p2]);
    expect(rows).toHaveLength(2);
    const byUnidad = Object.fromEntries(rows.map(r => [r.unidad, r]));
    expect(byUnidad.planta.avgCantidad).toBe(100);
    expect(byUnidad.hectarea.avgCantidad).toBe(2);
  });

  test('same labor different loteId buckets separately', () => {
    const p = (segId, loteId) => planilla({
      segmentos: [seg(segId, 'Deshierva', loteId, 'planta')],
      trabajadores: [worker('u1', { [segId]: 100 })],
    });
    const rows = productivityMatrix([
      p('s1', 'lote-a'), p('s1', 'lote-a'), p('s1', 'lote-a'),
      p('s1', 'lote-b'), p('s1', 'lote-b'), p('s1', 'lote-b'),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.loteId).sort()).toEqual(['lote-a', 'lote-b']);
  });

  test('zero or negative cantidad is skipped (represents "not assigned")', () => {
    const mk = (qty) => planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [worker('u1', { s1: qty })],
    });
    // 2 real assignments + 1 zero → below threshold → dropped entirely
    const rows = productivityMatrix([mk(100), mk(50), mk(0)]);
    expect(rows).toEqual([]);
  });

  test('missing trabajadorId is skipped', () => {
    const p = planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [{ cantidades: { s1: 100 } }], // no trabajadorId
    });
    expect(productivityMatrix([p, p, p])).toEqual([]);
  });

  test('segment without labor is skipped', () => {
    const p = planilla({
      segmentos: [seg('s1', '', 'lote-a', 'planta')],
      trabajadores: [worker('u1', { s1: 100 })],
    });
    expect(productivityMatrix([p, p, p])).toEqual([]);
  });

  test('cantidad for a missing segId is skipped', () => {
    const p = planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [worker('u1', { s_missing: 100 })],
    });
    expect(productivityMatrix([p, p, p])).toEqual([]);
  });

  test('custom minSamplesPerPair=1 keeps all buckets', () => {
    const p = planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [worker('u1', { s1: 100 })],
    });
    const rows = productivityMatrix([p], { minSamplesPerPair: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].avgCantidad).toBe(100);
  });

  test('confidence escalates with samples', () => {
    const mk = () => planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [worker('u1', { s1: 100 })],
    });
    // 5 samples → medium
    let rows = productivityMatrix(Array(5).fill(0).map(mk));
    expect(rows[0].confidence).toBe('medium');
    // 10 samples → high
    rows = productivityMatrix(Array(10).fill(0).map(mk));
    expect(rows[0].confidence).toBe('high');
  });

  test('averages diverging quantities correctly', () => {
    const p1 = planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [worker('u1', { s1: 100 })],
    });
    const p2 = planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [worker('u1', { s1: 150 })],
    });
    const p3 = planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [worker('u1', { s1: 50 })],
    });
    const rows = productivityMatrix([p1, p2, p3]);
    expect(rows[0].samples).toBe(3);
    expect(rows[0].totalCantidad).toBe(300);
    expect(rows[0].avgCantidad).toBe(100);
  });

  test('rows are sorted by labor then by avgCantidad desc within a bucket', () => {
    const mk = (uid, qty) => planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [worker(uid, { s1: qty })],
    });
    const rows = productivityMatrix([
      mk('u1', 50), mk('u1', 50), mk('u1', 50),
      mk('u2', 100), mk('u2', 100), mk('u2', 100),
    ]);
    expect(rows.map(r => r.userId)).toEqual(['u2', 'u1']);
  });

  test('two workers on same segment in one planilla counts as 1 sample each', () => {
    const p = planilla({
      segmentos: [seg('s1', 'Deshierva', 'lote-a', 'planta')],
      trabajadores: [
        worker('u1', { s1: 100 }),
        worker('u2', { s1: 80 }),
      ],
    });
    const rows = productivityMatrix([p, p, p]);
    const byUser = Object.fromEntries(rows.map(r => [r.userId, r]));
    expect(byUser.u1.samples).toBe(3);
    expect(byUser.u2.samples).toBe(3);
    expect(byUser.u1.avgCantidad).toBe(100);
    expect(byUser.u2.avgCantidad).toBe(80);
  });
});
