// Unit tests for the credit product validator. Pure — no Firestore.

const {
  buildCreditProductDoc,
  VALID_ESQUEMAS,
  _internals: { normalizeRequisito },
  _limits,
} = require('../../lib/financing/creditProductValidator');

function base() {
  return {
    providerName: 'Banco Agrícola',
    providerType: 'banco',
    tipo: 'agricola',
    esquemaAmortizacion: 'cuota_fija',
    moneda: 'USD',
    monedaMin: 1000,
    monedaMax: 50000,
    plazoMesesMin: 6,
    plazoMesesMax: 24,
    aprMin: 0.08,
    aprMax: 0.18,
    requisitos: [
      { tipo: 'documento', codigo: 'rut', descripcion: 'Cédula jurídica' },
    ],
  };
}

describe('normalizeRequisito', () => {
  test('accepts valid requisito and trims strings', () => {
    expect(normalizeRequisito({ tipo: 'garantia', codigo: '  fiduciaria ', descripcion: 'Aval ' })).toEqual({
      tipo: 'garantia', codigo: 'fiduciaria', descripcion: 'Aval',
    });
  });

  test('rejects unknown tipo', () => {
    expect(normalizeRequisito({ tipo: 'weird', codigo: 'x', descripcion: 'y' })).toBe('invalid_tipo');
  });

  test('requires codigo and descripcion', () => {
    expect(normalizeRequisito({ tipo: 'documento', descripcion: 'x' })).toBe('missing_codigo');
    expect(normalizeRequisito({ tipo: 'documento', codigo: 'a' })).toBe('missing_descripcion');
  });

  test('rejects non-objects', () => {
    expect(normalizeRequisito(null)).toBe('invalid_shape');
    expect(normalizeRequisito('string')).toBe('invalid_shape');
  });
});

describe('buildCreditProductDoc — happy path', () => {
  test('returns normalized doc with defaults', () => {
    const { data, error } = buildCreditProductDoc(base());
    expect(error).toBeUndefined();
    expect(data.providerName).toBe('Banco Agrícola');
    expect(data.activo).toBe(true); // default
    expect(data.fuente).toBe('manual'); // default
    expect(data.descripcion).toBeNull();
    expect(data.requisitos).toHaveLength(1);
  });

  test('respects activo: false', () => {
    const { data } = buildCreditProductDoc({ ...base(), activo: false });
    expect(data.activo).toBe(false);
  });

  test('accepts fuente=api:prefix', () => {
    const { data, error } = buildCreditProductDoc({ ...base(), fuente: 'api:scotia' });
    expect(error).toBeUndefined();
    expect(data.fuente).toBe('api:scotia');
  });
});

describe('buildCreditProductDoc — enum rejections', () => {
  test.each([
    ['providerType', 'random'],
    ['tipo', 'retail'],
    ['esquemaAmortizacion', 'mystery'],
  ])('rejects invalid %s', (field, bad) => {
    const { error } = buildCreditProductDoc({ ...base(), [field]: bad });
    expect(error).toMatch(new RegExp(field));
  });

  test('rejects fuente that is neither manual nor api:*', () => {
    const { error } = buildCreditProductDoc({ ...base(), fuente: 'csv' });
    expect(error).toMatch(/fuente/);
  });
});

describe('buildCreditProductDoc — range rejections', () => {
  test('rejects monedaMin > monedaMax', () => {
    const { error } = buildCreditProductDoc({ ...base(), monedaMin: 60000, monedaMax: 50000 });
    expect(error).toMatch(/monedaMin/);
  });

  test('rejects monedaMin ≤ 0', () => {
    const { error } = buildCreditProductDoc({ ...base(), monedaMin: 0 });
    expect(error).toMatch(/monedaMin/);
  });

  test('rejects plazo out of [1,60]', () => {
    expect(buildCreditProductDoc({ ...base(), plazoMesesMin: 0 }).error).toMatch(/plazoMesesMin/);
    expect(buildCreditProductDoc({ ...base(), plazoMesesMax: 72 }).error).toMatch(/plazoMesesMax/);
  });

  test('rejects non-integer plazo', () => {
    const { error } = buildCreditProductDoc({ ...base(), plazoMesesMin: 6.5, plazoMesesMax: 24 });
    expect(error).toMatch(/integer/);
  });

  test('rejects apr > ceiling', () => {
    const { error } = buildCreditProductDoc({ ...base(), aprMax: _limits.MAX_APR + 0.01 });
    expect(error).toMatch(/aprMax/);
  });

  test('rejects aprMin > aprMax', () => {
    const { error } = buildCreditProductDoc({ ...base(), aprMin: 0.25, aprMax: 0.18 });
    expect(error).toMatch(/aprMin/);
  });

  test('rejects negative apr', () => {
    const { error } = buildCreditProductDoc({ ...base(), aprMin: -0.01 });
    expect(error).toMatch(/aprMin/);
  });
});

describe('buildCreditProductDoc — requisitos', () => {
  test('accepts empty array', () => {
    const { data, error } = buildCreditProductDoc({ ...base(), requisitos: [] });
    expect(error).toBeUndefined();
    expect(data.requisitos).toEqual([]);
  });

  test('rejects requisito with missing fields', () => {
    const { error } = buildCreditProductDoc({
      ...base(),
      requisitos: [{ tipo: 'documento', codigo: 'x' }], // missing descripcion
    });
    expect(error).toMatch(/requisitos\[0\]/);
  });

  test('rejects requisito with unknown tipo', () => {
    const { error } = buildCreditProductDoc({
      ...base(),
      requisitos: [{ tipo: 'other', codigo: 'a', descripcion: 'b' }],
    });
    expect(error).toMatch(/invalid_tipo/);
  });

  test('caps number of requisitos', () => {
    const tooMany = Array.from({ length: 31 }, (_, i) => ({
      tipo: 'documento', codigo: `c${i}`, descripcion: `d${i}`,
    }));
    const { error } = buildCreditProductDoc({ ...base(), requisitos: tooMany });
    expect(error).toMatch(/Too many/);
  });
});

describe('buildCreditProductDoc — misc', () => {
  test('rejects missing body', () => {
    expect(buildCreditProductDoc(null).error).toBeDefined();
    expect(buildCreditProductDoc(undefined).error).toBeDefined();
  });

  test('rejects missing providerName', () => {
    const body = base();
    delete body.providerName;
    expect(buildCreditProductDoc(body).error).toMatch(/providerName/);
  });

  test('defaults moneda to USD when invalid', () => {
    const { data } = buildCreditProductDoc({ ...base(), moneda: 'EUR' });
    expect(data.moneda).toBe('USD');
  });

  test('esquema set contains all three expected values', () => {
    expect([...VALID_ESQUEMAS].sort()).toEqual(['amortizacion_constante', 'bullet', 'cuota_fija']);
  });
});
