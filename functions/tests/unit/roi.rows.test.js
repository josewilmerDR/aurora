// Unit tests for ROI row construction. Pure — no Firestore.

const { buildRoiReport, _internals } = require('../../lib/finance/roiRows');
const { buildRow, distributeByKg, marginPct, precioPromedio, costoPorKg } = _internals;

describe('buildRow', () => {
  test('positive margin', () => {
    const row = buildRow({ loteId: 'L1', cost: 500, kg: 1000 }, 800);
    expect(row.costos).toBe(500);
    expect(row.ingresos).toBe(800);
    expect(row.margen).toBe(300);
    expect(row.margenPct).toBe(60); // 300/500 * 100
    expect(row.precioPromedio).toBe(0.8);
    expect(row.costoPorKg).toBe(0.5);
    expect(row.kg).toBe(1000);
    expect(row.cost).toBeUndefined(); // renombrado a costos
  });

  test('negative margin (pérdida)', () => {
    const row = buildRow({ cost: 1000, kg: 500 }, 400);
    expect(row.margen).toBe(-600);
    expect(row.margenPct).toBe(-60);
  });

  test('zero costs → margenPct null', () => {
    const row = buildRow({ cost: 0, kg: 100 }, 200);
    expect(row.margenPct).toBeNull();
  });

  test('zero kg → precio/costoPorKg null', () => {
    const row = buildRow({ cost: 100, kg: 0 }, 200);
    expect(row.precioPromedio).toBeNull();
    expect(row.costoPorKg).toBeNull();
  });
});

describe('distributeByKg', () => {
  test('distributes proportional to kg', () => {
    const children = [{ kg: 100 }, { kg: 300 }];
    const dist = distributeByKg(1000, children);
    expect(dist.get(children[0])).toBeCloseTo(250); // 100/400
    expect(dist.get(children[1])).toBeCloseTo(750);
  });

  test('zero income → empty map', () => {
    expect(distributeByKg(0, [{ kg: 100 }]).size).toBe(0);
  });

  test('empty children → empty map', () => {
    expect(distributeByKg(500, []).size).toBe(0);
  });

  test('all children kg=0 → empty map', () => {
    expect(distributeByKg(500, [{ kg: 0 }, { kg: 0 }]).size).toBe(0);
  });
});

describe('buildRoiReport', () => {
  const cost = {
    resumen: { cost: 1500, kg: 3000 },
    porLote: [
      { loteId: 'L1', loteNombre: 'Lote 1', hectareas: 10, cost: 1000, kg: 2000 },
      { loteId: 'L2', loteNombre: 'Lote 2', hectareas: 5, cost: 500, kg: 1000 },
    ],
    porGrupo: [
      { loteId: 'L1', loteNombre: 'Lote 1', grupo: 'G1', cost: 600, kg: 1200 },
      { loteId: 'L1', loteNombre: 'Lote 1', grupo: 'G2', cost: 400, kg: 800 },
      { loteId: 'L2', loteNombre: 'Lote 2', grupo: 'G1', cost: 500, kg: 1000 },
    ],
    porBloque: [
      { loteId: 'L1', bloqueId: 'B1', bloque: 'B1', grupo: 'G1', cost: 600, kg: 1200 },
      { loteId: 'L1', bloqueId: 'B2', bloque: 'B2', grupo: 'G2', cost: 400, kg: 800 },
      { loteId: 'L2', bloqueId: 'B3', bloque: 'B3', grupo: 'G1', cost: 500, kg: 1000 },
    ],
  };

  test('happy path — both lotes profitable', () => {
    const report = buildRoiReport(cost, { L1: 2000, L2: 800 });
    const l1 = report.porLote.find(r => r.loteId === 'L1');
    const l2 = report.porLote.find(r => r.loteId === 'L2');
    expect(l1.ingresos).toBe(2000);
    expect(l1.costos).toBe(1000);
    expect(l1.margen).toBe(1000);
    expect(l1.margenPct).toBe(100);
    expect(l2.margen).toBe(300);

    expect(report.resumen.ingresos).toBe(2800);
    expect(report.resumen.costos).toBe(1500);
    expect(report.resumen.margen).toBe(1300);
  });

  test('porLote sorted by margen desc', () => {
    const report = buildRoiReport(cost, { L1: 100, L2: 900 });
    // L2 margen = 400, L1 margen = -900 → L2 primero
    expect(report.porLote[0].loteId).toBe('L2');
    expect(report.porLote[1].loteId).toBe('L1');
  });

  test('income distributed among grupos proportional to kg', () => {
    const report = buildRoiReport(cost, { L1: 1000 });
    // L1 tiene G1 (1200 kg) y G2 (800 kg), total 2000 kg
    // G1 recibe 1000 × 1200/2000 = 600
    // G2 recibe 1000 × 800/2000  = 400
    const g1 = report.porGrupo.find(g => g.grupo === 'G1' && g.loteId === 'L1');
    const g2 = report.porGrupo.find(g => g.grupo === 'G2' && g.loteId === 'L1');
    expect(g1.ingresos).toBe(600);
    expect(g2.ingresos).toBe(400);
  });

  test('income distributed among bloques proportional to kg', () => {
    const report = buildRoiReport(cost, { L1: 1000 });
    const b1 = report.porBloque.find(b => b.bloqueId === 'B1');
    const b2 = report.porBloque.find(b => b.bloqueId === 'B2');
    expect(b1.ingresos).toBe(600);
    expect(b2.ingresos).toBe(400);
  });

  test('lote with income but no cost → synthetic row created', () => {
    const report = buildRoiReport(cost, { L1: 1000, L2: 500, L3_NEW: 300 });
    const l3 = report.porLote.find(r => r.loteId === 'L3_NEW');
    expect(l3).toBeDefined();
    expect(l3.ingresos).toBe(300);
    expect(l3.costos).toBe(0);
    expect(l3.margenPct).toBeNull(); // sin costos, margenPct undefined
    expect(l3.kg).toBe(0);
  });

  test('no income → costos all sit as losses', () => {
    const report = buildRoiReport(cost, {});
    expect(report.resumen.ingresos).toBe(0);
    expect(report.resumen.margen).toBe(-1500);
  });

  test('empty cost input is safe', () => {
    const report = buildRoiReport(null, { L1: 100 });
    expect(report.porLote).toHaveLength(1);
    expect(report.porLote[0].loteId).toBe('L1');
    expect(report.resumen.ingresos).toBe(100);
    expect(report.resumen.costos).toBe(0);
  });

  test('lote without kg → income stays at lote level, grupo/bloque show 0', () => {
    const costNoKg = {
      resumen: { cost: 500, kg: 0 },
      porLote: [{ loteId: 'L1', cost: 500, kg: 0 }],
      porGrupo: [{ loteId: 'L1', grupo: 'G1', cost: 500, kg: 0 }],
      porBloque: [{ loteId: 'L1', bloqueId: 'B1', cost: 500, kg: 0 }],
    };
    const report = buildRoiReport(costNoKg, { L1: 1000 });
    expect(report.porLote[0].ingresos).toBe(1000);
    expect(report.porGrupo[0].ingresos).toBe(0);
    expect(report.porBloque[0].ingresos).toBe(0);
  });
});
