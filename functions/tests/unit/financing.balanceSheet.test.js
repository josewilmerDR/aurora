// Unit tests for the balance sheet aggregator. Pure — no Firestore.

const {
  buildBalanceSheet,
  computeAccountsReceivable,
  computeInventory,
  computeFixedAssets,
  computeAccountsPayable,
  computeDebtObligations,
  depreciationPerHour,
  hoursFromRecord,
} = require('../../lib/financing/balanceSheetAggregator');

describe('depreciationPerHour', () => {
  test('returns (gross - residual) / hours', () => {
    expect(depreciationPerHour({ valorAdquisicion: 10000, valorResidual: 2000, vidaUtilHoras: 1000 })).toBe(8);
  });
  test('returns 0 for invalid input', () => {
    expect(depreciationPerHour(null)).toBe(0);
    expect(depreciationPerHour({ valorAdquisicion: 10000, valorResidual: 2000, vidaUtilHoras: 0 })).toBe(0);
    expect(depreciationPerHour({ valorAdquisicion: 'x' })).toBe(0);
  });
});

describe('hoursFromRecord', () => {
  test('returns final - initial when valid', () => {
    expect(hoursFromRecord({ horimetroInicial: 100, horimetroFinal: 108 })).toBe(8);
  });
  test('returns 0 when final < initial or values invalid', () => {
    expect(hoursFromRecord({ horimetroInicial: 100, horimetroFinal: 50 })).toBe(0);
    expect(hoursFromRecord({})).toBe(0);
  });
});

describe('computeAccountsReceivable', () => {
  test('sums pending invoices with date ≤ asOf', () => {
    const records = [
      { collectionStatus: 'pendiente', date: '2026-01-10', totalAmount: 500 },
      { collectionStatus: 'pendiente', date: '2026-04-15', totalAmount: 200 },
      { collectionStatus: 'cobrado',   date: '2026-03-01', totalAmount: 999 },
      { collectionStatus: 'anulado',   date: '2026-02-01', totalAmount: 100 },
    ];
    const out = computeAccountsReceivable(records, '2026-04-10');
    expect(out.amount).toBe(500);
    expect(out.invoiceCount).toBe(1);
  });

  test('skips non-positive amounts', () => {
    const records = [
      { collectionStatus: 'pendiente', date: '2026-01-01', totalAmount: 0 },
      { collectionStatus: 'pendiente', date: '2026-01-01', totalAmount: -50 },
      { collectionStatus: 'pendiente', date: '2026-01-01', totalAmount: 50 },
    ];
    expect(computeAccountsReceivable(records, '2026-12-31').amount).toBe(50);
  });

  test('empty input returns zero', () => {
    expect(computeAccountsReceivable([], '2026-01-01')).toEqual({ amount: 0, invoiceCount: 0 });
    expect(computeAccountsReceivable(null, '2026-01-01')).toEqual({ amount: 0, invoiceCount: 0 });
  });
});

describe('computeInventory', () => {
  test('values stock × precioUnitario', () => {
    const productos = [
      { stockActual: 10, precioUnitario: 5 },
      { stockActual: 3,  precioUnitario: 20 },
    ];
    const out = computeInventory(productos);
    expect(out.amount).toBe(110);
    expect(out.itemCount).toBe(2);
    expect(out.itemsWithoutPrice).toBe(0);
  });

  test('skips items without price and flags count', () => {
    const productos = [
      { stockActual: 10 }, // no price
      { stockActual: 5, precioUnitario: 0 }, // zero price skipped
      { stockActual: 2, precioUnitario: 100 },
    ];
    const out = computeInventory(productos);
    expect(out.amount).toBe(200);
    expect(out.itemCount).toBe(1);
    expect(out.itemsWithoutPrice).toBe(2);
  });

  test('skips items with no stock', () => {
    const productos = [
      { stockActual: 0, precioUnitario: 100 },
      { stockActual: -5, precioUnitario: 100 },
    ];
    expect(computeInventory(productos).amount).toBe(0);
  });
});

describe('computeFixedAssets', () => {
  test('accumulates hours from horimetro ≤ asOf per tractor/implemento', () => {
    const maquinaria = [
      { id: 'T1', valorAdquisicion: 10000, valorResidual: 2000, vidaUtilHoras: 1000 },
      { id: 'I1', valorAdquisicion: 4000,  valorResidual: 0,    vidaUtilHoras: 500 },
    ];
    const horimetro = [
      { fecha: '2026-01-15', tractorId: 'T1', implementoId: 'I1', horimetroInicial: 0, horimetroFinal: 100 },
      { fecha: '2026-04-10', tractorId: 'T1', implementoId: 'I1', horimetroInicial: 100, horimetroFinal: 150 },
      { fecha: '2027-01-01', tractorId: 'T1', implementoId: 'I1', horimetroInicial: 150, horimetroFinal: 200 }, // after asOf
    ];
    const out = computeFixedAssets(maquinaria, horimetro, '2026-12-31');
    // T1: 150 hours × 8/hour = 1200 dep ; I1: 150 hours × 8/hour = 1200 dep
    expect(out.grossValue).toBe(14000);
    expect(out.accumulatedDepreciation).toBe(2400);
    expect(out.netBookValue).toBe(11600);
    expect(out.assetCount).toBe(2);
  });

  test('caps depreciation at depreciable base (gross - residual)', () => {
    const maquinaria = [{ id: 'T1', valorAdquisicion: 10000, valorResidual: 2000, vidaUtilHoras: 100 }];
    const horimetro = [
      { fecha: '2026-01-01', tractorId: 'T1', horimetroInicial: 0, horimetroFinal: 1000 }, // way over life
    ];
    const out = computeFixedAssets(maquinaria, horimetro, '2026-12-31');
    expect(out.accumulatedDepreciation).toBe(8000); // capped at 10k - 2k
    expect(out.netBookValue).toBe(2000);
  });

  test('handles empty inputs', () => {
    expect(computeFixedAssets([], [], '2026-01-01')).toEqual({
      grossValue: 0, accumulatedDepreciation: 0, netBookValue: 0, assetCount: 0,
    });
  });
});

describe('computeAccountsPayable', () => {
  test('sums open OCs emitted on or before asOf', () => {
    const ocs = [
      { estado: 'pendiente', fechaEmision: '2026-03-01', items: [{ cantidad: 10, precioUnitario: 20 }] }, // 200
      { estado: 'recibida', fechaEmision: '2026-04-01',  items: [{ cantidad: 2,  precioUnitario: 50 }] }, // 100
      { estado: 'pagada',    fechaEmision: '2026-01-01', items: [{ cantidad: 5, precioUnitario: 100 }] }, // excluded
      { estado: 'cancelada', fechaEmision: '2026-02-01', items: [{ cantidad: 3, precioUnitario: 10 }] },  // excluded
      { estado: 'pendiente', fechaEmision: '2027-01-01', items: [{ cantidad: 1, precioUnitario: 999 }] }, // after asOf
    ];
    const out = computeAccountsPayable(ocs, '2026-12-31');
    expect(out.amount).toBe(300);
    expect(out.orderCount).toBe(2);
  });

  test('ignores OCs without items or with zero total', () => {
    const ocs = [
      { estado: 'pendiente', fechaEmision: '2026-01-01', items: [] },
      { estado: 'pendiente', fechaEmision: '2026-01-01', items: [{ cantidad: 0, precioUnitario: 50 }] },
    ];
    expect(computeAccountsPayable(ocs, '2026-12-31')).toEqual({ amount: 0, orderCount: 0 });
  });
});

describe('computeDebtObligations', () => {
  test('sums outstanding balances for approved/active apps', () => {
    const apps = [
      { status: 'approved', outstandingBalance: 5000 },
      { status: 'active',   approvedAmount: 3000 },
      { status: 'pending',  approvedAmount: 9999 }, // excluded
      { status: 'rejected', outstandingBalance: 1234 }, // excluded
    ];
    expect(computeDebtObligations(apps)).toEqual({ amount: 8000, count: 2 });
  });

  test('empty is safe', () => {
    expect(computeDebtObligations([])).toEqual({ amount: 0, count: 0 });
    expect(computeDebtObligations(undefined)).toEqual({ amount: 0, count: 0 });
  });
});

describe('buildBalanceSheet', () => {
  test('integrates all pieces; equity = assets - liabilities', () => {
    const bs = buildBalanceSheet({
      cashBalance: { amount: 10000, dateAsOf: '2026-04-01' },
      incomeRecords: [
        { collectionStatus: 'pendiente', date: '2026-03-10', totalAmount: 2000 },
      ],
      productos: [
        { stockActual: 50, precioUnitario: 10 }, // 500
      ],
      maquinaria: [
        { id: 'T1', valorAdquisicion: 5000, valorResidual: 1000, vidaUtilHoras: 1000 },
      ],
      horimetroAll: [
        { fecha: '2026-02-01', tractorId: 'T1', horimetroInicial: 0, horimetroFinal: 100 },
      ],
      ordenesCompra: [
        { estado: 'pendiente', fechaEmision: '2026-03-01', items: [{ cantidad: 10, precioUnitario: 30 }] }, // 300
      ],
      creditApplications: [],
      asOf: '2026-04-01',
    });

    expect(bs.assets.cash.amount).toBe(10000);
    expect(bs.assets.accountsReceivable.amount).toBe(2000);
    expect(bs.assets.inventory.amount).toBe(500);
    // fixed: gross 5000, hours 100 × 4/hour = 400 dep → net 4600
    expect(bs.assets.fixedAssets.netBookValue).toBe(4600);
    expect(bs.assets.totalAssets).toBe(17100);

    expect(bs.liabilities.accountsPayable.amount).toBe(300);
    expect(bs.liabilities.totalLiabilities).toBe(300);

    expect(bs.equity.totalEquity).toBe(16800);
  });

  test('flags NO_CASH_BALANCE_RECORD when cash null', () => {
    const bs = buildBalanceSheet({
      cashBalance: null,
      incomeRecords: [], productos: [], maquinaria: [], horimetroAll: [],
      ordenesCompra: [], creditApplications: [], asOf: '2026-04-01',
    });
    expect(bs.notes).toContain('NO_CASH_BALANCE_RECORD');
    expect(bs.assets.cash.amount).toBe(0);
    expect(bs.equity.totalEquity).toBe(0);
  });

  test('flags INVENTORY_MISSING_PRICE with count', () => {
    const bs = buildBalanceSheet({
      cashBalance: { amount: 0 },
      incomeRecords: [], maquinaria: [], horimetroAll: [], ordenesCompra: [], creditApplications: [],
      productos: [
        { stockActual: 10 }, // missing
        { stockActual: 5 },  // missing
        { stockActual: 2, precioUnitario: 100 },
      ],
      asOf: '2026-04-01',
    });
    expect(bs.notes.some(n => n.startsWith('INVENTORY_MISSING_PRICE:2'))).toBe(true);
  });
});
