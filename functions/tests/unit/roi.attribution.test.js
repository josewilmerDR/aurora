// Unit tests for income attribution. Pure — no Firestore.

const {
  attributeIncome,
  prorateByKg,
  mergeLoteAmounts,
  buildDespachoToLoteMap,
} = require('../../lib/finance/roiAttribution');

describe('attributeIncome', () => {
  test('direct loteId → attributed to that lote', () => {
    const records = [{ loteId: 'L1', totalAmount: 100 }];
    const out = attributeIncome(records, {});
    expect(out.perLote).toEqual({ L1: 100 });
    expect(out.unattributedAmount).toBe(0);
  });

  test('despachoId falls back to lote via map', () => {
    const records = [{ despachoId: 'D1', totalAmount: 200 }];
    const out = attributeIncome(records, { D1: 'L2' });
    expect(out.perLote).toEqual({ L2: 200 });
    expect(out.unattributedAmount).toBe(0);
  });

  test('loteId wins over despachoId', () => {
    const records = [{ loteId: 'L1', despachoId: 'D1', totalAmount: 300 }];
    const out = attributeIncome(records, { D1: 'L9' });
    expect(out.perLote).toEqual({ L1: 300 });
  });

  test('unknown despachoId → unattributed', () => {
    const records = [{ despachoId: 'D-unknown', totalAmount: 400 }];
    const out = attributeIncome(records, {});
    expect(out.perLote).toEqual({});
    expect(out.unattributedAmount).toBe(400);
    expect(out.unattributedRecords).toHaveLength(1);
  });

  test('records with collectionStatus=anulado are skipped', () => {
    const records = [
      { loteId: 'L1', totalAmount: 100, collectionStatus: 'anulado' },
      { loteId: 'L1', totalAmount: 50, collectionStatus: 'pendiente' },
    ];
    const out = attributeIncome(records, {});
    expect(out.perLote).toEqual({ L1: 50 });
  });

  test('zero or negative amounts are skipped', () => {
    const records = [
      { loteId: 'L1', totalAmount: 0 },
      { loteId: 'L1', totalAmount: -10 },
      { loteId: 'L1', totalAmount: 5 },
    ];
    expect(attributeIncome(records, {}).perLote).toEqual({ L1: 5 });
  });

  test('sums multiple records for the same lote', () => {
    const records = [
      { loteId: 'L1', totalAmount: 100 },
      { loteId: 'L1', totalAmount: 250 },
      { loteId: 'L2', totalAmount: 50 },
    ];
    expect(attributeIncome(records, {}).perLote).toEqual({ L1: 350, L2: 50 });
  });

  test('non-string loteId is ignored (falls through)', () => {
    const records = [{ loteId: 42, despachoId: 'D1', totalAmount: 100 }];
    const out = attributeIncome(records, { D1: 'L5' });
    expect(out.perLote).toEqual({ L5: 100 });
  });

  test('despachoIds[] splits proportionally by cantidad', () => {
    const records = [{
      despachoIds: [
        { id: 'D1', cantidad: 100 },
        { id: 'D2', cantidad: 300 },
      ],
      totalAmount: 1000,
    }];
    const out = attributeIncome(records, { D1: 'L1', D2: 'L2' });
    expect(out.perLote.L1).toBeCloseTo(250); // 100/400 * 1000
    expect(out.perLote.L2).toBeCloseTo(750); // 300/400 * 1000
    expect(out.unattributedAmount).toBe(0);
  });

  test('despachoIds[] with same lote accumulates', () => {
    const records = [{
      despachoIds: [
        { id: 'D1', cantidad: 100 },
        { id: 'D2', cantidad: 100 },
      ],
      totalAmount: 500,
    }];
    const out = attributeIncome(records, { D1: 'LA', D2: 'LA' });
    expect(out.perLote.LA).toBeCloseTo(500);
  });

  test('despachoIds[] with no cantidad falls back to equal weight', () => {
    const records = [{
      despachoIds: [{ id: 'D1' }, { id: 'D2' }],
      totalAmount: 200,
    }];
    const out = attributeIncome(records, { D1: 'L1', D2: 'L2' });
    expect(out.perLote.L1).toBeCloseTo(100);
    expect(out.perLote.L2).toBeCloseTo(100);
  });

  test('despachoIds[] with unknown items sends that fraction to unattributed', () => {
    const records = [{
      despachoIds: [
        { id: 'D1', cantidad: 100 },
        { id: 'UNKNOWN', cantidad: 100 },
      ],
      totalAmount: 200,
    }];
    const out = attributeIncome(records, { D1: 'L1' });
    expect(out.perLote.L1).toBeCloseTo(200); // known fraction gets full attribution inside its bucket
    expect(out.unattributedAmount).toBeGreaterThan(0);
  });

  test('explicit loteId wins over despachoIds[]', () => {
    const records = [{
      loteId: 'LX',
      despachoIds: [{ id: 'D1', cantidad: 100 }],
      totalAmount: 300,
    }];
    const out = attributeIncome(records, { D1: 'L9' });
    expect(out.perLote).toEqual({ LX: 300 });
  });

  test('despachoIds[] takes priority over legacy despachoId', () => {
    const records = [{
      despachoId: 'D_LEGACY',
      despachoIds: [{ id: 'D1', cantidad: 50 }],
      totalAmount: 100,
    }];
    const out = attributeIncome(records, { D_LEGACY: 'L_OLD', D1: 'L_NEW' });
    expect(out.perLote).toEqual({ L_NEW: 100 });
  });
});

describe('prorateByKg', () => {
  test('prorates proportional to kg', () => {
    const out = prorateByKg(1000, { L1: 100, L2: 400 });
    expect(out.L1).toBeCloseTo(200); // 100/500 * 1000
    expect(out.L2).toBeCloseTo(800); // 400/500 * 1000
  });

  test('empty kgByLote → no distribution', () => {
    expect(prorateByKg(500, {})).toEqual({});
  });

  test('zero amount → no distribution', () => {
    expect(prorateByKg(0, { L1: 100 })).toEqual({});
  });

  test('zero kg on all lotes → no distribution', () => {
    expect(prorateByKg(500, { L1: 0, L2: 0 })).toEqual({});
  });

  test('skips lotes with 0 kg but still prorates among the rest', () => {
    const out = prorateByKg(100, { L1: 100, L2: 0, L3: 100 });
    expect(out.L1).toBeCloseTo(50);
    expect(out.L3).toBeCloseTo(50);
    expect(out.L2).toBeUndefined();
  });
});

describe('mergeLoteAmounts', () => {
  test('sums overlapping keys', () => {
    expect(mergeLoteAmounts({ L1: 10, L2: 20 }, { L1: 5, L3: 30 })).toEqual({
      L1: 15, L2: 20, L3: 30,
    });
  });
  test('handles missing inputs', () => {
    expect(mergeLoteAmounts({}, { L1: 5 })).toEqual({ L1: 5 });
    expect(mergeLoteAmounts({ L1: 5 }, {})).toEqual({ L1: 5 });
  });
});

describe('buildDespachoToLoteMap', () => {
  test('maps id → loteId', () => {
    const docs = [
      { id: 'D1', loteId: 'L1' },
      { id: 'D2', loteId: 'L2' },
    ];
    expect(buildDespachoToLoteMap(docs)).toEqual({ D1: 'L1', D2: 'L2' });
  });
  test('skips docs missing id or loteId', () => {
    const docs = [
      { id: 'D1', loteId: 'L1' },
      { loteId: 'L2' },
      { id: 'D3' },
    ];
    expect(buildDespachoToLoteMap(docs)).toEqual({ D1: 'L1' });
  });
  test('handles null/undefined input', () => {
    expect(buildDespachoToLoteMap()).toEqual({});
    expect(buildDespachoToLoteMap(null)).toEqual({});
  });
});
