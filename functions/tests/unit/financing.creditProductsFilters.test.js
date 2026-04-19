// Unit tests for the in-memory filter predicate used by the credit-products
// list endpoint. Firestore returns everything for the finca; we slice it here.

const {
  _internals: { matchesFilters },
} = require('../../routes/financing/creditProducts');

function product(overrides = {}) {
  return {
    tipo: 'agricola',
    providerType: 'banco',
    activo: true,
    monedaMin: 1000, monedaMax: 50000,
    plazoMesesMin: 6, plazoMesesMax: 24,
    aprMin: 0.08, aprMax: 0.18,
    ...overrides,
  };
}

describe('matchesFilters — identity', () => {
  test('passes with empty query', () => {
    expect(matchesFilters(product(), {})).toBe(true);
  });
});

describe('matchesFilters — enum filters', () => {
  test('tipo filter', () => {
    expect(matchesFilters(product({ tipo: 'agricola' }), { tipo: 'agricola' })).toBe(true);
    expect(matchesFilters(product({ tipo: 'agricola' }), { tipo: 'leasing' })).toBe(false);
  });

  test('providerType filter', () => {
    expect(matchesFilters(product({ providerType: 'banco' }), { providerType: 'cooperativa' })).toBe(false);
  });

  test('activo filter accepts string booleans', () => {
    expect(matchesFilters(product({ activo: true }), { activo: 'true' })).toBe(true);
    expect(matchesFilters(product({ activo: true }), { activo: 'false' })).toBe(false);
    expect(matchesFilters(product({ activo: false }), { activo: 'false' })).toBe(true);
  });
});

describe('matchesFilters — amount overlap', () => {
  test('included when product window covers the request', () => {
    expect(matchesFilters(product({ monedaMin: 1000, monedaMax: 50000 }), { amountMin: 20000, amountMax: 30000 })).toBe(true);
  });

  test('excluded when product max < amountMin', () => {
    expect(matchesFilters(product({ monedaMax: 10000 }), { amountMin: 20000 })).toBe(false);
  });

  test('excluded when product min > amountMax', () => {
    expect(matchesFilters(product({ monedaMin: 60000 }), { amountMax: 50000 })).toBe(false);
  });

  test('partial overlap (product window extends beyond) still passes', () => {
    expect(matchesFilters(product({ monedaMin: 1000, monedaMax: 100000 }), { amountMin: 50000, amountMax: 150000 })).toBe(true);
  });
});

describe('matchesFilters — plazo overlap', () => {
  test('excluded when product plazoMax < plazoMin query', () => {
    expect(matchesFilters(product({ plazoMesesMax: 6 }), { plazoMin: 12 })).toBe(false);
  });

  test('excluded when product plazoMin > plazoMax query', () => {
    expect(matchesFilters(product({ plazoMesesMin: 36 }), { plazoMax: 24 })).toBe(false);
  });

  test('exact match passes', () => {
    expect(matchesFilters(product({ plazoMesesMin: 12, plazoMesesMax: 12 }), { plazoMin: 12, plazoMax: 12 })).toBe(true);
  });
});

describe('matchesFilters — combined', () => {
  test('all filters together: pass', () => {
    const query = { tipo: 'agricola', providerType: 'banco', activo: 'true', amountMin: 5000, plazoMin: 12 };
    expect(matchesFilters(product(), query)).toBe(true);
  });

  test('any single mismatch fails the whole predicate', () => {
    const query = { tipo: 'leasing', amountMin: 5000 };
    expect(matchesFilters(product(), query)).toBe(false);
  });
});
