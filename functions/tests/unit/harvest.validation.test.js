// Unit tests for the harvest (cosecha) domain validation layer. Pure — no Firestore.
//
// Cubre los invariantes de payload que sostienen la seguridad del dominio:
//   - normalizeBoletas: whitelist + cota del array de boletas, y el rechazo de
//     ids con '/' (H1: evita el throw síncrono de .doc() al verificar boletas).
//   - validateCosechaPayload: requeridos, rangos y la fecha estricta.
//   - isValidISODate / maxAllowedFechaISO: primitivos de fecha compartidos por
//     registros y despachos (H7).

const {
  requireEncargado,
  normalizeBoletas,
  validateCosechaPayload,
  isValidISODate,
  maxAllowedFechaISO,
} = require('../../routes/harvest/validation');
const { ERROR_CODES } = require('../../lib/errors');

describe('isValidISODate (H7)', () => {
  test('accepts real dates', () => {
    expect(isValidISODate('2026-04-17')).toBe(true);
    expect(isValidISODate('2024-02-29')).toBe(true); // leap year
  });
  test('rejects fake dates that new Date() would silently normalize', () => {
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2025-02-29')).toBe(false); // not a leap year
  });
  test('rejects wrong format / non-strings', () => {
    expect(isValidISODate('17/04/2026')).toBe(false);
    expect(isValidISODate('2026-4-7')).toBe(false);
    expect(isValidISODate('')).toBe(false);
    expect(isValidISODate(null)).toBe(false);
    expect(isValidISODate(20260417)).toBe(false);
  });
});

describe('maxAllowedFechaISO (H7)', () => {
  test('is tomorrow UTC in YYYY-MM-DD form', () => {
    const out = maxAllowedFechaISO();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const today = new Date().toISOString().slice(0, 10);
    expect(out > today).toBe(true);
  });
});

describe('normalizeBoletas (H1)', () => {
  test('undefined/null yields an empty list, not an error', () => {
    expect(normalizeBoletas(undefined)).toEqual({ boletas: [] });
    expect(normalizeBoletas(null)).toEqual({ boletas: [] });
  });

  test('rejects a non-array', () => {
    expect(normalizeBoletas('nope').error).toMatch(/must be an array/i);
    expect(normalizeBoletas({ id: 'x' }).error).toMatch(/must be an array/i);
  });

  test('caps the array length', () => {
    const many = Array.from({ length: 257 }, (_, i) => ({ id: `b${i}` }));
    expect(normalizeBoletas(many).error).toMatch(/too many/i);
  });

  test('rejects non-object boleta entries', () => {
    expect(normalizeBoletas(['x']).error).toMatch(/must be an object/i);
    expect(normalizeBoletas([['a']]).error).toMatch(/must be an object/i);
    expect(normalizeBoletas([null]).error).toMatch(/must be an object/i);
  });

  test('requires a valid string id', () => {
    expect(normalizeBoletas([{}]).error).toMatch(/valid id/i);
    expect(normalizeBoletas([{ id: '' }]).error).toMatch(/valid id/i);
    expect(normalizeBoletas([{ id: 123 }]).error).toMatch(/valid id/i);
    expect(normalizeBoletas([{ id: 'x'.repeat(1501) }]).error).toMatch(/valid id/i);
  });

  test("rejects an id containing '/' (would throw synchronously in .doc())", () => {
    expect(normalizeBoletas([{ id: 'a/b' }]).error).toMatch(/valid id/i);
    expect(normalizeBoletas([{ id: 'cosecha_registros/abc' }]).error).toMatch(/valid id/i);
  });

  test('whitelists fields — drops anything but id/consecutivo/cantidad', () => {
    const { boletas } = normalizeBoletas([
      { id: 'b1', consecutivo: 'RC-000001', cantidad: 10, evil: { nested: true }, fincaId: 'other' },
    ]);
    expect(boletas).toEqual([{ id: 'b1', consecutivo: 'RC-000001', cantidad: 10 }]);
  });

  test('validates consecutivo type and length', () => {
    expect(normalizeBoletas([{ id: 'b1', consecutivo: 123 }]).error).toMatch(/consecutivo/i);
    expect(normalizeBoletas([{ id: 'b1', consecutivo: 'x'.repeat(65) }]).error).toMatch(/consecutivo/i);
    expect(normalizeBoletas([{ id: 'b1', consecutivo: 'RC-1' }]).boletas[0].consecutivo).toBe('RC-1');
  });

  test('coerces and range-checks cantidad; ignores empty', () => {
    expect(normalizeBoletas([{ id: 'b1', cantidad: -1 }]).error).toMatch(/cantidad/i);
    expect(normalizeBoletas([{ id: 'b1', cantidad: 16384 }]).error).toMatch(/cantidad/i);
    expect(normalizeBoletas([{ id: 'b1', cantidad: 'abc' }]).error).toMatch(/cantidad/i);
    expect(normalizeBoletas([{ id: 'b1', cantidad: '12.5' }]).boletas[0].cantidad).toBe(12.5);
    // Empty/absent cantidad is allowed and simply omitted.
    expect(normalizeBoletas([{ id: 'b1', cantidad: '' }]).boletas[0]).toEqual({ id: 'b1' });
    expect(normalizeBoletas([{ id: 'b1' }]).boletas[0]).toEqual({ id: 'b1' });
  });
});

describe('validateCosechaPayload', () => {
  const valid = { fecha: '2026-04-17', loteId: 'lote-1', cantidad: 5 };

  test('accepts a minimal valid payload', () => {
    expect(validateCosechaPayload(valid)).toBeNull();
  });

  test('rejects missing / malformed / impossible / future fecha', () => {
    expect(validateCosechaPayload({ ...valid, fecha: undefined })).toMatch(/date is required/i);
    expect(validateCosechaPayload({ ...valid, fecha: '2026/04/17' })).toMatch(/date is required/i);
    expect(validateCosechaPayload({ ...valid, fecha: '2026-02-30' })).toMatch(/date is required/i);
    expect(validateCosechaPayload({ ...valid, fecha: '2999-01-01' })).toMatch(/after the current day/i);
  });

  test('requires loteId within length bounds', () => {
    expect(validateCosechaPayload({ ...valid, loteId: '' })).toMatch(/lote is required/i);
    expect(validateCosechaPayload({ ...valid, loteId: '   ' })).toMatch(/lote is required/i);
    expect(validateCosechaPayload({ ...valid, loteId: 'x'.repeat(129) })).toMatch(/too long/i);
  });

  test('requires cantidad strictly between 0 and 16384', () => {
    expect(validateCosechaPayload({ ...valid, cantidad: 0 })).toMatch(/greater than 0/i);
    expect(validateCosechaPayload({ ...valid, cantidad: -3 })).toMatch(/greater than 0/i);
    expect(validateCosechaPayload({ ...valid, cantidad: 16384 })).toMatch(/less than 16384/i);
    expect(validateCosechaPayload({ ...valid, cantidad: 'abc' })).toMatch(/greater than 0/i);
  });

  test('bounds optional string fields and the note length', () => {
    expect(validateCosechaPayload({ ...valid, nota: 'x'.repeat(288) })).toMatch(/note cannot exceed/i);
    expect(validateCosechaPayload({ ...valid, loteNombre: 'x'.repeat(129) })).toMatch(/lote name/i);
    expect(validateCosechaPayload({ ...valid, nota: 'x'.repeat(287) })).toBeNull();
  });

  test('partial mode skips required checks for absent fields', () => {
    // A partial update touching only the note must not demand fecha/loteId/cantidad.
    expect(validateCosechaPayload({ nota: 'ok' }, { partial: true })).toBeNull();
    // …but still validates a field that IS present.
    expect(validateCosechaPayload({ cantidad: 0 }, { partial: true })).toMatch(/greater than 0/i);
  });
});

describe('requireEncargado middleware', () => {
  function run(userRole) {
    let statusCode = null;
    let body = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(payload) { body = payload; return this; },
    };
    let nextCalled = false;
    requireEncargado({ userRole }, res, () => { nextCalled = true; });
    return { statusCode, body, nextCalled };
  }

  test('lets encargado and above through', () => {
    for (const role of ['encargado', 'supervisor', 'administrador']) {
      const { nextCalled, statusCode } = run(role);
      expect(nextCalled).toBe(true);
      expect(statusCode).toBeNull();
    }
  });

  test('blocks trabajador and unknown roles with 403 + INSUFFICIENT_ROLE', () => {
    for (const role of ['trabajador', undefined, 'bogus']) {
      const { nextCalled, statusCode, body } = run(role);
      expect(nextCalled).toBe(false);
      expect(statusCode).toBe(403);
      expect(body.code).toBe(ERROR_CODES.INSUFFICIENT_ROLE);
    }
  });
});
