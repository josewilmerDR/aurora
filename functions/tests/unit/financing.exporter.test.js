// Unit tests for the profile exporter. Pure — no Firestore.

const {
  toHtml,
  toJson,
  _internals: { escape, fmtMoney, fmtPercent, categoryLabel },
} = require('../../lib/financing/profileExporter');

const FIXTURE = Object.freeze({
  fincaId: 'finca_aurora_test',
  asOf: '2026-04-18',
  historyRange: { from: '2025-04-18', to: '2026-04-18' },
  projectionRange: { from: '2026-04-18', to: '2026-10-18' },
  balanceSheet: {
    asOf: '2026-04-18',
    assets: {
      cash: { amount: 10000, dateAsOf: '2026-04-01' },
      accountsReceivable: { amount: 2000, invoiceCount: 1 },
      inventory: { amount: 500, itemCount: 1 },
      fixedAssets: { grossValue: 5000, accumulatedDepreciation: 400, netBookValue: 4600, assetCount: 1 },
      totalAssets: 17100,
    },
    liabilities: {
      accountsPayable: { amount: 300, orderCount: 1 },
      debtObligations: { amount: 0, count: 0 },
      totalLiabilities: 300,
    },
    equity: { totalEquity: 16800 },
    notes: ['NO_CASH_BALANCE_RECORD'],
  },
  incomeStatement: {
    periodStart: '2025-04-18', periodEnd: '2026-04-18',
    revenue: { amount: 2000, recordCount: 1 },
    costs: {
      byCategory: { combustible: 100, depreciacion: 0, planilla_directa: 500, planilla_fija: 0, insumos: 0, mantenimiento: 0, administrativo: 0, otro: 0 },
      totalCosts: 600,
    },
    netMargin: 1400, marginRatio: 0.7,
  },
  cashFlow: {
    history: {
      series: [{ month: '2026-03', inflows: 1000, outflows: 300, net: 700 }],
      summary: { totalInflows: 1000, totalOutflows: 300, netChange: 700 },
    },
    projection: {
      series: [{ month: '2026-04', inflows: 500, outflows: 0, net: 500, openingBalance: 10000, endingBalance: 10500 }],
      startingBalance: 10000,
      summary: { totalInflows: 500, totalOutflows: 0, endingBalance: 10500, minBalance: 10500 },
    },
  },
  inputsHash: 'sha256:abc',
  sourceCounts: { incomeRecords: 1 },
});

describe('escape', () => {
  test('escapes HTML special chars', () => {
    expect(escape('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });
  test('handles null/undefined/numbers', () => {
    expect(escape(null)).toBe('');
    expect(escape(undefined)).toBe('');
    expect(escape(42)).toBe('42');
  });
});

describe('fmtMoney', () => {
  test('formats USD by default', () => {
    expect(fmtMoney(1234.5)).toBe('$1,234.50');
  });
  test('formats CRC with ₡', () => {
    expect(fmtMoney(1234.5, 'CRC')).toBe('₡1,234.50');
  });
  test('handles non-finite', () => {
    expect(fmtMoney(NaN)).toBe('—');
    expect(fmtMoney(null)).toBe('—');
  });
  test('formats negatives correctly', () => {
    expect(fmtMoney(-500)).toBe('$-500.00');
  });
});

describe('fmtPercent', () => {
  test('renders as percent with 1 decimal', () => {
    expect(fmtPercent(0.75)).toBe('75.0%');
  });
  test('handles non-finite', () => {
    expect(fmtPercent(NaN)).toBe('—');
  });
});

describe('categoryLabel', () => {
  test('maps known keys to Spanish labels', () => {
    expect(categoryLabel('combustible')).toBe('Combustible');
    expect(categoryLabel('planilla_directa')).toBe('Planilla directa');
  });
  test('falls through for unknown keys', () => {
    expect(categoryLabel('__custom__')).toBe('__custom__');
  });
});

describe('toJson', () => {
  test('serializes profile with meta', () => {
    const out = JSON.parse(toJson(FIXTURE, { snapshotId: 'S1' }));
    expect(out.fincaId).toBe('finca_aurora_test');
    expect(out.meta.snapshotId).toBe('S1');
    expect(out.inputsHash).toBe('sha256:abc');
  });
});

describe('toHtml', () => {
  test('produces a full HTML document', () => {
    const html = toHtml(FIXTURE);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Estado Financiero');
    expect(html).toContain('Balance General');
    expect(html).toContain('Estado de Resultados');
    expect(html).toContain('Flujo de caja');
  });

  test('includes formatted monetary values', () => {
    const html = toHtml(FIXTURE);
    expect(html).toContain('$17,100.00'); // total assets
    expect(html).toContain('$16,800.00'); // total equity
    expect(html).toContain('70.0%');      // margin ratio
  });

  test('escapes user-controlled fields', () => {
    const danger = {
      ...FIXTURE,
      fincaId: '<script>alert(1)</script>',
    };
    const html = toHtml(danger);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('renders notes when present', () => {
    const html = toHtml(FIXTURE);
    expect(html).toContain('NO_CASH_BALANCE_RECORD');
  });

  test('includes snapshot id when passed in meta', () => {
    const html = toHtml(FIXTURE, { snapshotId: 'snap_123', generatedAt: '2026-04-19T12:00:00Z' });
    expect(html).toContain('snap_123');
    expect(html).toContain('2026-04-19 12:00:00');
  });
});
