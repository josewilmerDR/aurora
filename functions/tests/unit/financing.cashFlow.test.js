// Unit tests for the cash flow aggregator. Pure — no Firestore.

const {
  buildCashFlow,
  buildHistory,
  buildProjection,
  buildHistoricalEvents,
  bucketEventsByMonth,
  monthsInRange,
} = require('../../lib/financing/cashFlowAggregator');

describe('monthsInRange', () => {
  test('enumerates months inclusively', () => {
    expect(monthsInRange('2026-01-15', '2026-04-10')).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04',
    ]);
  });

  test('spans year boundary', () => {
    expect(monthsInRange('2025-11-01', '2026-02-28')).toEqual([
      '2025-11', '2025-12', '2026-01', '2026-02',
    ]);
  });

  test('single month when same YYYY-MM', () => {
    expect(monthsInRange('2026-04-01', '2026-04-30')).toEqual(['2026-04']);
  });

  test('invalid input returns empty', () => {
    expect(monthsInRange(null, '2026-01-01')).toEqual([]);
    expect(monthsInRange('abc', '2026-01-01')).toEqual([]);
  });
});

describe('bucketEventsByMonth', () => {
  test('groups events into correct buckets', () => {
    const months = ['2026-01', '2026-02', '2026-03'];
    const events = [
      { date: '2026-01-10', amount: 100, type: 'inflow' },
      { date: '2026-01-20', amount: 50,  type: 'outflow' },
      { date: '2026-02-05', amount: 200, type: 'inflow' },
      { date: '2026-04-01', amount: 999, type: 'inflow' }, // out of range
    ];
    const out = bucketEventsByMonth(events, months);
    expect(out[0]).toEqual({ month: '2026-01', inflows: 100, outflows: 50, net: 50 });
    expect(out[1]).toEqual({ month: '2026-02', inflows: 200, outflows: 0,  net: 200 });
    expect(out[2]).toEqual({ month: '2026-03', inflows: 0,   outflows: 0,  net: 0 });
  });

  test('skips non-positive and malformed events', () => {
    const out = bucketEventsByMonth(
      [
        { date: '2026-01-01', amount: 0, type: 'inflow' },
        { date: '2026-01-01', amount: -10, type: 'outflow' },
        { amount: 10, type: 'inflow' }, // no date
      ],
      ['2026-01'],
    );
    expect(out[0].inflows).toBe(0);
    expect(out[0].outflows).toBe(0);
  });
});

describe('buildHistoricalEvents', () => {
  const range = { from: '2026-01-01', to: '2026-06-30' };

  test('emits an inflow only for cobrado income records', () => {
    const events = buildHistoricalEvents({
      incomeRecords: [
        { collectionStatus: 'cobrado',   actualCollectionDate: '2026-03-10', totalAmount: 500 },
        { collectionStatus: 'pendiente', actualCollectionDate: '2026-03-10', totalAmount: 999 },
      ],
      horimetro: [], planillaUnidad: [], planillaFija: [], cedulas: [], costosIndirectos: [],
      productos: [], range,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ date: '2026-03-10', amount: 500, type: 'inflow', source: 'income' });
  });

  test('emits outflows for combustible + planillas + indirectos + insumos', () => {
    const events = buildHistoricalEvents({
      incomeRecords: [],
      horimetro: [{ fecha: '2026-02-01', combustible: { costoEstimado: 50 } }],
      planillaUnidad: [{ fecha: '2026-02-15', totalGeneral: 300 }],
      planillaFija:   [{ periodoInicio: '2026-02-01', totalGeneral: 1000 }],
      cedulas: [{ status: 'aplicada_en_campo', aplicadaAt: '2026-03-01', snap_productos: [{ total: 10, precioUnitario: 5 }] }],
      costosIndirectos: [{ fecha: '2026-04-01', monto: 200 }],
      productos: [],
      range,
    });
    const sources = events.map(e => e.source).sort();
    expect(sources).toEqual(['combustible', 'indirectos', 'insumos', 'planilla_fija', 'planilla_unidad']);
    expect(events.every(e => e.type === 'outflow')).toBe(true);
  });

  test('excludes events outside the range', () => {
    const events = buildHistoricalEvents({
      incomeRecords: [{ collectionStatus: 'cobrado', actualCollectionDate: '2025-12-31', totalAmount: 100 }],
      horimetro: [{ fecha: '2026-07-01', combustible: { costoEstimado: 999 } }],
      planillaUnidad: [], planillaFija: [], cedulas: [], costosIndirectos: [],
      productos: [], range,
    });
    expect(events).toEqual([]);
  });
});

describe('buildProjection', () => {
  test('running balance accumulates correctly', () => {
    const projection = buildProjection({
      events: [
        { date: '2026-05-01', amount: 1000, type: 'inflow' },
        { date: '2026-05-15', amount: 500,  type: 'outflow' },
        { date: '2026-06-01', amount: 200,  type: 'outflow' },
      ],
      startingBalance: 1000,
      range: { from: '2026-05-01', to: '2026-07-31' },
    });
    expect(projection[0].openingBalance).toBe(1000);
    expect(projection[0].endingBalance).toBe(1500); // 1000 + 500
    expect(projection[1].openingBalance).toBe(1500);
    expect(projection[1].endingBalance).toBe(1300); // 1500 - 200
    expect(projection[2].endingBalance).toBe(1300); // no events
  });

  test('negative starting balance still works', () => {
    const projection = buildProjection({
      events: [],
      startingBalance: -500,
      range: { from: '2026-01-01', to: '2026-02-28' },
    });
    expect(projection[0].openingBalance).toBe(-500);
    expect(projection[1].endingBalance).toBe(-500);
  });
});

describe('buildCashFlow', () => {
  test('assembles history + projection with summaries', () => {
    const out = buildCashFlow({
      rawHistoryInputs: {
        incomeRecords: [{ collectionStatus: 'cobrado', actualCollectionDate: '2026-03-10', totalAmount: 1000 }],
        horimetro: [], planillaUnidad: [{ fecha: '2026-03-20', totalGeneral: 300 }],
        planillaFija: [], cedulas: [], costosIndirectos: [], productos: [],
        range: { from: '2026-01-01', to: '2026-03-31' },
      },
      projectionEvents: [
        { date: '2026-04-10', amount: 500, type: 'inflow' },
      ],
      startingBalance: 2000,
      projectionRange: { from: '2026-04-01', to: '2026-04-30' },
    });

    expect(out.history.series.length).toBe(3);
    expect(out.history.summary.totalInflows).toBe(1000);
    expect(out.history.summary.totalOutflows).toBe(300);
    expect(out.history.summary.netChange).toBe(700);

    expect(out.projection.series.length).toBe(1);
    expect(out.projection.summary.endingBalance).toBe(2500);
    expect(out.projection.summary.minBalance).toBe(2500);
  });

  test('min balance reflects the lowest projected month', () => {
    const out = buildCashFlow({
      rawHistoryInputs: {
        incomeRecords: [], horimetro: [], planillaUnidad: [], planillaFija: [],
        cedulas: [], costosIndirectos: [], productos: [],
        range: { from: '2026-01-01', to: '2026-01-31' },
      },
      projectionEvents: [
        { date: '2026-02-15', amount: 3000, type: 'outflow' }, // dips to -2000
        { date: '2026-03-10', amount: 500,  type: 'inflow' },
      ],
      startingBalance: 1000,
      projectionRange: { from: '2026-02-01', to: '2026-03-31' },
    });
    expect(out.projection.summary.minBalance).toBe(-2000);
    expect(out.projection.summary.endingBalance).toBe(-1500);
  });
});
