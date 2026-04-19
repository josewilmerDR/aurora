// Unit tests for the income statement aggregator. Pure — no Firestore.

const {
  buildIncomeStatement,
  computeRevenue,
  computeCosts,
} = require('../../lib/financing/incomeStatementAggregator');

const RANGE = { from: '2026-01-01', to: '2026-12-31' };

describe('computeRevenue', () => {
  test('sums non-voided income records in range', () => {
    const records = [
      { collectionStatus: 'pendiente', date: '2026-03-10', totalAmount: 500 },
      { collectionStatus: 'cobrado',   date: '2026-06-01', totalAmount: 1000 },
      { collectionStatus: 'anulado',   date: '2026-04-01', totalAmount: 9999 }, // excluded
      { collectionStatus: 'pendiente', date: '2027-01-01', totalAmount: 400 },  // out of range
      { collectionStatus: 'pendiente', date: '2025-12-31', totalAmount: 400 },  // out of range
    ];
    const out = computeRevenue(records, RANGE);
    expect(out.amount).toBe(1500);
    expect(out.recordCount).toBe(2);
  });

  test('skips non-positive amounts', () => {
    const records = [
      { collectionStatus: 'pendiente', date: '2026-03-01', totalAmount: 0 },
      { collectionStatus: 'pendiente', date: '2026-03-01', totalAmount: -100 },
      { collectionStatus: 'pendiente', date: '2026-03-01', totalAmount: 50 },
    ];
    expect(computeRevenue(records, RANGE).amount).toBe(50);
  });
});

describe('computeCosts', () => {
  test('combustible + depreciation from horimetro', () => {
    const out = computeCosts({
      horimetro: [
        { fecha: '2026-03-01', tractorId: 'T1', implementoId: 'I1', horimetroInicial: 0, horimetroFinal: 10, combustible: { costoEstimado: 100 } },
      ],
      planillaUnidad: [], planillaFija: [], cedulas: [], costosIndirectos: [],
      maquinaria: [
        { id: 'T1', valorAdquisicion: 10000, valorResidual: 0, vidaUtilHoras: 1000 }, // 10/hour
        { id: 'I1', valorAdquisicion: 5000,  valorResidual: 0, vidaUtilHoras: 1000 }, // 5/hour
      ],
      productos: [],
      range: RANGE,
    });
    expect(out.byCategory.combustible).toBe(100);
    expect(out.byCategory.depreciacion).toBe(150); // 10h × (10+5)
    expect(out.totalCosts).toBe(250);
  });

  test('planilla directa + fija', () => {
    const out = computeCosts({
      horimetro: [],
      planillaUnidad: [{ fecha: '2026-05-01', totalGeneral: 300 }],
      planillaFija:   [{ periodoInicio: '2026-05-01', totalGeneral: 1000 }],
      cedulas: [], costosIndirectos: [], maquinaria: [], productos: [],
      range: RANGE,
    });
    expect(out.byCategory.planilla_directa).toBe(300);
    expect(out.byCategory.planilla_fija).toBe(1000);
  });

  test('insumos from cedulas uses precioUnitario fallback', () => {
    const out = computeCosts({
      horimetro: [], planillaUnidad: [], planillaFija: [],
      cedulas: [
        {
          status: 'aplicada_en_campo', aplicadaAt: '2026-06-01',
          snap_productos: [
            { productoId: 'P1', total: 10, precioUnitario: 5 }, // 50
            { productoId: 'P2', total: 2 },                     // falls back to prodMap → 100 × 2 = 200
            { productoId: 'P3', total: 1 },                     // no price anywhere → 0
          ],
        },
      ],
      costosIndirectos: [], maquinaria: [],
      productos: [{ id: 'P2', precioUnitario: 100 }],
      range: RANGE,
    });
    expect(out.byCategory.insumos).toBe(250);
  });

  test('costos indirectos by categoria; unknown → otro', () => {
    const out = computeCosts({
      horimetro: [], planillaUnidad: [], planillaFija: [], cedulas: [],
      costosIndirectos: [
        { fecha: '2026-02-01', categoria: 'mantenimiento', monto: 500 },
        { fecha: '2026-03-01', categoria: 'administrativo', monto: 300 },
        { fecha: '2026-04-01', categoria: 'made_up_cat', monto: 200 },
        { fecha: '2026-05-01', monto: 100 }, // no categoria → otro
      ],
      maquinaria: [], productos: [], range: RANGE,
    });
    expect(out.byCategory.mantenimiento).toBe(500);
    expect(out.byCategory.administrativo).toBe(300);
    expect(out.byCategory.otro).toBe(300);
  });

  test('excludes cedulas not in aplicada_en_campo status', () => {
    const out = computeCosts({
      horimetro: [], planillaUnidad: [], planillaFija: [],
      cedulas: [
        { status: 'aplicada_en_campo', aplicadaAt: '2026-03-01', snap_productos: [{ total: 1, precioUnitario: 100 }] },
        { status: 'pendiente',          aplicadaAt: '2026-03-01', snap_productos: [{ total: 1, precioUnitario: 99999 }] },
      ],
      costosIndirectos: [], maquinaria: [], productos: [], range: RANGE,
    });
    expect(out.byCategory.insumos).toBe(100);
  });

  test('returns zero for out-of-range entries', () => {
    const out = computeCosts({
      horimetro: [{ fecha: '2025-01-01', tractorId: 'T1', combustible: { costoEstimado: 999 } }],
      planillaUnidad: [], planillaFija: [], cedulas: [], costosIndirectos: [],
      maquinaria: [], productos: [], range: RANGE,
    });
    expect(out.byCategory.combustible).toBe(0);
  });
});

describe('buildIncomeStatement', () => {
  test('net margin = revenue - totalCosts', () => {
    const is = buildIncomeStatement({
      incomeRecords: [{ collectionStatus: 'pendiente', date: '2026-05-01', totalAmount: 2000 }],
      horimetro: [], planillaUnidad: [
        { fecha: '2026-05-01', totalGeneral: 500 },
      ],
      planillaFija: [], cedulas: [], costosIndirectos: [],
      maquinaria: [], productos: [],
      range: RANGE,
    });
    expect(is.revenue.amount).toBe(2000);
    expect(is.costs.totalCosts).toBe(500);
    expect(is.netMargin).toBe(1500);
    expect(is.marginRatio).toBe(0.75);
  });

  test('marginRatio is 0 when revenue is 0', () => {
    const is = buildIncomeStatement({
      incomeRecords: [], horimetro: [], planillaUnidad: [{ fecha: '2026-01-01', totalGeneral: 100 }],
      planillaFija: [], cedulas: [], costosIndirectos: [],
      maquinaria: [], productos: [], range: RANGE,
    });
    expect(is.revenue.amount).toBe(0);
    expect(is.marginRatio).toBe(0);
    expect(is.netMargin).toBe(-100);
  });
});
