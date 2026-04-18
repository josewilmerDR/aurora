// Unit tests for yieldAggregator's pure helpers. Firestore integration
// (computeYieldAggregate end-to-end) is covered separately; this suite
// exercises the rollup/rowFromBucket/intersection primitives.

const {
  _rowFromBucket,
  _emptyBucket,
  _mergeIntoBucket,
  _rollupByDimension,
  _resumenFromRows,
  _intersectRange,
} = require('../../lib/strategy/yieldAggregator');

describe('_emptyBucket', () => {
  test('produces a zeroed bucket', () => {
    const b = _emptyBucket('k', 'label');
    expect(b).toEqual({
      key: 'k',
      label: 'label',
      hectareas: 0,
      kg: 0,
      costo: 0,
      ingreso: 0,
      primeraCosecha: null,
      ultimaCosecha: null,
      nAplicaciones: 0,
      nCosechas: 0,
    });
  });
});

describe('_mergeIntoBucket', () => {
  test('sums numeric fields', () => {
    const b = _emptyBucket('p1', 'P1');
    _mergeIntoBucket(b, {
      hectareas: 5, kg: 100, costo: 200, ingreso: 500,
      nAplicaciones: 2, nCosechas: 3,
      primeraCosecha: '2024-01-10', ultimaCosecha: '2024-03-01',
    });
    _mergeIntoBucket(b, {
      hectareas: 2, kg: 50, costo: 80, ingreso: 120,
      nAplicaciones: 1, nCosechas: 2,
      primeraCosecha: '2024-01-01', ultimaCosecha: '2024-02-15',
    });
    expect(b.hectareas).toBe(7);
    expect(b.kg).toBe(150);
    expect(b.costo).toBe(280);
    expect(b.ingreso).toBe(620);
    expect(b.nAplicaciones).toBe(3);
    expect(b.nCosechas).toBe(5);
    expect(b.primeraCosecha).toBe('2024-01-01');
    expect(b.ultimaCosecha).toBe('2024-03-01');
  });

  test('handles null dates gracefully', () => {
    const b = _emptyBucket('x', 'X');
    _mergeIntoBucket(b, {
      hectareas: 1, kg: 10, costo: 5, ingreso: 20,
      primeraCosecha: null, ultimaCosecha: null,
      nAplicaciones: 0, nCosechas: 0,
    });
    expect(b.primeraCosecha).toBeNull();
    expect(b.ultimaCosecha).toBeNull();
  });
});

describe('_rowFromBucket', () => {
  test('computes derived ratios correctly', () => {
    const row = _rowFromBucket({
      key: 'L1',
      label: 'Lote Norte',
      hectareas: 10,
      kg: 2000,
      costo: 1500,
      ingreso: 3000,
      primeraCosecha: '2024-01-01',
      ultimaCosecha: '2024-03-31',
      nAplicaciones: 4,
      nCosechas: 8,
    });
    expect(row.margen).toBe(1500);
    expect(row.kgPorHa).toBe(200);
    expect(row.ingresoPorHa).toBe(300);
    expect(row.costoPorHa).toBe(150);
    expect(row.margenPorHa).toBe(150);
    expect(row.margenPct).toBe(50); // 1500/3000 * 100
    expect(row.diasCiclo).toBe(90);
    expect(row.nAplicaciones).toBe(4);
    expect(row.nCosechas).toBe(8);
  });

  test('zero hectareas → null per-ha metrics (no divide by zero)', () => {
    const row = _rowFromBucket({
      key: 'L0',
      label: 'Sin área',
      hectareas: 0,
      kg: 500,
      costo: 100,
      ingreso: 800,
      primeraCosecha: null,
      ultimaCosecha: null,
      nAplicaciones: 0,
      nCosechas: 1,
    });
    expect(row.kgPorHa).toBeNull();
    expect(row.ingresoPorHa).toBeNull();
    expect(row.costoPorHa).toBeNull();
    expect(row.margenPorHa).toBeNull();
  });

  test('zero ingreso → margenPct null', () => {
    const row = _rowFromBucket({
      key: 'L2',
      label: 'L2',
      hectareas: 5,
      kg: 100,
      costo: 100,
      ingreso: 0,
      primeraCosecha: null,
      ultimaCosecha: null,
      nAplicaciones: 0,
      nCosechas: 0,
    });
    expect(row.margenPct).toBeNull();
    expect(row.margen).toBe(-100);
  });

  test('null cosechas → diasCiclo null', () => {
    const row = _rowFromBucket({
      key: 'L3',
      label: 'L3',
      hectareas: 1,
      kg: 0,
      costo: 0,
      ingreso: 0,
      primeraCosecha: null,
      ultimaCosecha: null,
      nAplicaciones: 0,
      nCosechas: 0,
    });
    expect(row.diasCiclo).toBeNull();
  });
});

describe('_rollupByDimension — groupBy=lote', () => {
  test('emits one row per lote, sorted by margen desc', () => {
    const base = {
      L1: {
        loteId: 'L1', loteNombre: 'Norte', hectareas: 10, paqueteId: 'P1',
        kg: 1000, costo: 500, ingreso: 2000,
        primeraCosecha: '2024-01-01', ultimaCosecha: '2024-02-01',
        nAplicaciones: 2, nCosechas: 4,
      },
      L2: {
        loteId: 'L2', loteNombre: 'Sur', hectareas: 5, paqueteId: 'P2',
        kg: 500, costo: 400, ingreso: 600,
        primeraCosecha: '2024-01-15', ultimaCosecha: '2024-02-15',
        nAplicaciones: 1, nCosechas: 3,
      },
    };
    const rows = _rollupByDimension(base, 'lote', { packagesById: {} });
    expect(rows).toHaveLength(2);
    expect(rows[0].label).toBe('Norte'); // margen 1500 > margen 200
    expect(rows[1].label).toBe('Sur');
  });
});

describe('_rollupByDimension — groupBy=paquete', () => {
  test('merges lotes sharing paqueteId', () => {
    const base = {
      L1: {
        loteId: 'L1', loteNombre: 'Norte', hectareas: 10, paqueteId: 'P1',
        kg: 1000, costo: 500, ingreso: 2000,
        primeraCosecha: '2024-01-01', ultimaCosecha: '2024-02-01',
        nAplicaciones: 2, nCosechas: 4,
      },
      L2: {
        loteId: 'L2', loteNombre: 'Norte 2', hectareas: 5, paqueteId: 'P1',
        kg: 500, costo: 200, ingreso: 800,
        primeraCosecha: '2024-01-10', ultimaCosecha: '2024-02-20',
        nAplicaciones: 1, nCosechas: 2,
      },
      L3: {
        loteId: 'L3', loteNombre: 'Sur', hectareas: 4, paqueteId: 'P2',
        kg: 300, costo: 100, ingreso: 400,
        primeraCosecha: '2024-01-05', ultimaCosecha: '2024-02-05',
        nAplicaciones: 1, nCosechas: 1,
      },
    };
    const packagesById = {
      P1: { nombrePaquete: 'Tomate A', tipoCosecha: 'I Cosecha' },
      P2: { nombrePaquete: 'Chile B', tipoCosecha: 'II Cosecha' },
    };
    const rows = _rollupByDimension(base, 'paquete', { packagesById });
    expect(rows).toHaveLength(2);
    const tomate = rows.find(r => r.label === 'Tomate A');
    expect(tomate.kg).toBe(1500);
    expect(tomate.hectareas).toBe(15);
    expect(tomate.ingreso).toBe(2800);
    expect(tomate.nCosechas).toBe(6);
    expect(tomate.primeraCosecha).toBeUndefined(); // no leak of internals
  });

  test('lotes without paqueteId get "_sin_paquete" bucket', () => {
    const base = {
      L1: {
        loteId: 'L1', loteNombre: 'X', hectareas: 1, paqueteId: null,
        kg: 100, costo: 50, ingreso: 200,
        primeraCosecha: null, ultimaCosecha: null,
        nAplicaciones: 0, nCosechas: 1,
      },
    };
    const rows = _rollupByDimension(base, 'paquete', { packagesById: {} });
    expect(rows[0].key).toBe('_sin_paquete');
    expect(rows[0].label).toBe('Sin paquete');
  });
});

describe('_rollupByDimension — groupBy=cultivo', () => {
  test('aggregates by tipoCosecha from packages', () => {
    const base = {
      L1: {
        loteId: 'L1', loteNombre: 'A', hectareas: 10, paqueteId: 'P1',
        kg: 1000, costo: 500, ingreso: 2000,
        primeraCosecha: null, ultimaCosecha: null,
        nAplicaciones: 0, nCosechas: 0,
      },
      L2: {
        loteId: 'L2', loteNombre: 'B', hectareas: 5, paqueteId: 'P2',
        kg: 300, costo: 200, ingreso: 500,
        primeraCosecha: null, ultimaCosecha: null,
        nAplicaciones: 0, nCosechas: 0,
      },
    };
    const packagesById = {
      P1: { nombrePaquete: 'X', tipoCosecha: 'I Cosecha' },
      P2: { nombrePaquete: 'Y', tipoCosecha: 'I Cosecha' }, // same
    };
    const rows = _rollupByDimension(base, 'cultivo', { packagesById });
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('I Cosecha');
    expect(rows[0].kg).toBe(1300);
    expect(rows[0].hectareas).toBe(15);
  });

  test('lotes without package → "Sin clasificar"', () => {
    const base = {
      L1: {
        loteId: 'L1', loteNombre: 'A', hectareas: 1, paqueteId: null,
        kg: 100, costo: 50, ingreso: 200,
        primeraCosecha: null, ultimaCosecha: null,
        nAplicaciones: 0, nCosechas: 0,
      },
    };
    const rows = _rollupByDimension(base, 'cultivo', { packagesById: {} });
    expect(rows[0].label).toBe('Sin clasificar');
  });
});

describe('_resumenFromRows', () => {
  test('aggregates totals and computes margin %', () => {
    const rows = [
      { kg: 100, ingreso: 500, costo: 200, margen: 300, hectareas: 5 },
      { kg: 200, ingreso: 1000, costo: 600, margen: 400, hectareas: 10 },
    ];
    const r = _resumenFromRows(rows);
    expect(r.kg).toBe(300);
    expect(r.ingreso).toBe(1500);
    expect(r.costo).toBe(800);
    expect(r.margen).toBe(700);
    expect(r.margenPct).toBeCloseTo(46.67, 1);
    expect(r.hectareasTotal).toBe(15);
    expect(r.nGrupos).toBe(2);
  });

  test('zero income → margenPct null', () => {
    const rows = [{ kg: 0, ingreso: 0, costo: 100, margen: -100, hectareas: 1 }];
    expect(_resumenFromRows(rows).margenPct).toBeNull();
  });

  test('empty rows', () => {
    const r = _resumenFromRows([]);
    expect(r).toEqual({
      kg: 0, ingreso: 0, costo: 0, margen: 0,
      margenPct: null, hectareasTotal: 0, nGrupos: 0,
    });
  });
});

describe('_intersectRange', () => {
  test('overlapping ranges → intersection', () => {
    expect(_intersectRange(
      { desde: '2024-01-01', hasta: '2024-06-30' },
      { desde: '2024-04-01', hasta: '2024-12-31' },
    )).toEqual({ desde: '2024-04-01', hasta: '2024-06-30' });
  });

  test('contained range → inner range', () => {
    expect(_intersectRange(
      { desde: '2024-01-01', hasta: '2024-12-31' },
      { desde: '2024-03-01', hasta: '2024-04-01' },
    )).toEqual({ desde: '2024-03-01', hasta: '2024-04-01' });
  });

  test('non-overlapping → null', () => {
    expect(_intersectRange(
      { desde: '2024-01-01', hasta: '2024-02-01' },
      { desde: '2024-03-01', hasta: '2024-04-01' },
    )).toBeNull();
  });

  test('touching at boundary → single-day intersection', () => {
    expect(_intersectRange(
      { desde: '2024-01-01', hasta: '2024-03-15' },
      { desde: '2024-03-15', hasta: '2024-06-30' },
    )).toEqual({ desde: '2024-03-15', hasta: '2024-03-15' });
  });
});
