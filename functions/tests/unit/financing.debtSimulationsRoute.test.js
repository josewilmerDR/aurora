// Unit tests for the debtSimulations route's pure helpers. The handlers
// themselves are covered by integration / manual testing (they hit Firestore).

const {
  _internals: { deriveBaseline, validateUseCase },
} = require('../../routes/financing/debtSimulations');

describe('deriveBaseline', () => {
  test('divides revenue + costs by 12', () => {
    const snap = {
      incomeStatement: {
        revenue: { amount: 120000 },
        costs: { totalCosts: 60000 },
      },
      balanceSheet: { assets: { cash: { amount: 20000 } } },
    };
    const out = deriveBaseline(snap);
    expect(out.baselineMonthlyRevenue).toBe(10000);
    expect(out.baselineMonthlyCost).toBe(5000);
    expect(out.initialCash).toBe(20000);
    expect(out.commitmentsByMonth).toEqual([]);
  });

  test('override wins over derived', () => {
    const snap = {
      incomeStatement: { revenue: { amount: 120000 }, costs: { totalCosts: 60000 } },
      balanceSheet: { assets: { cash: { amount: 20000 } } },
    };
    const out = deriveBaseline(snap, { initialCash: 50000, priceVolatility: 0.30 });
    expect(out.initialCash).toBe(50000);
    expect(out.priceVolatility).toBe(0.30);
    expect(out.baselineMonthlyRevenue).toBe(10000); // unchanged
  });

  test('missing snapshot sections → zeros', () => {
    const out = deriveBaseline({});
    expect(out.baselineMonthlyRevenue).toBe(0);
    expect(out.baselineMonthlyCost).toBe(0);
    expect(out.initialCash).toBe(0);
  });
});

describe('validateUseCase', () => {
  test('null → { value: null }', () => {
    expect(validateUseCase(null)).toEqual({ value: null });
    expect(validateUseCase(undefined)).toEqual({ value: null });
  });

  test('rejects unknown tipo', () => {
    expect(validateUseCase({ tipo: 'retail' }).error).toMatch(/tipo/);
  });

  test('rejects unknown expectedReturnModel.kind', () => {
    expect(validateUseCase({
      tipo: 'siembra',
      expectedReturnModel: { kind: 'random' },
    }).error).toMatch(/kind/);
  });

  test('happy path normalizes fields', () => {
    const out = validateUseCase({
      tipo: 'siembra',
      detalle: '  10 ha  ',
      expectedReturnModel: { kind: 'delayed_revenue', monthlyIncrease: '2000', startMonth: '3' },
    });
    expect(out.error).toBeUndefined();
    expect(out.value.tipo).toBe('siembra');
    expect(out.value.detalle).toBe('10 ha');
    expect(out.value.expectedReturnModel.monthlyIncrease).toBe(2000);
    expect(out.value.expectedReturnModel.startMonth).toBe(3);
  });

  test('accepts useCase without expectedReturnModel', () => {
    const out = validateUseCase({ tipo: 'liquidez', detalle: 'capital de trabajo' });
    expect(out.value.expectedReturnModel).toBeNull();
  });
});
