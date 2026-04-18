// Unit tests for seasonInference. Pure — no Firestore.

const {
  inferSeasons,
  _isValidIsoDate,
  _daysBetween,
  _toSequenceLetter,
  DEFAULTS,
} = require('../../lib/strategy/seasonInference');

describe('_isValidIsoDate', () => {
  test('accepts valid ISO dates', () => {
    expect(_isValidIsoDate('2024-01-15')).toBe(true);
    expect(_isValidIsoDate('2020-02-29')).toBe(true); // leap year
    expect(_isValidIsoDate('2024-12-31')).toBe(true);
  });
  test('rejects invalid formats', () => {
    expect(_isValidIsoDate('2024-1-1')).toBe(false);
    expect(_isValidIsoDate('24-01-15')).toBe(false);
    expect(_isValidIsoDate('2024/01/15')).toBe(false);
    expect(_isValidIsoDate(null)).toBe(false);
    expect(_isValidIsoDate(undefined)).toBe(false);
    expect(_isValidIsoDate(123)).toBe(false);
  });
  test('rejects impossible dates', () => {
    expect(_isValidIsoDate('2023-02-29')).toBe(false); // non-leap
    expect(_isValidIsoDate('2024-13-01')).toBe(false);
    expect(_isValidIsoDate('2024-02-30')).toBe(false);
  });
});

describe('_daysBetween', () => {
  test('counts calendar days', () => {
    expect(_daysBetween('2024-01-01', '2024-01-31')).toBe(30);
    expect(_daysBetween('2024-01-01', '2024-01-01')).toBe(0);
    expect(_daysBetween('2024-02-28', '2024-03-01')).toBe(2); // leap year
    expect(_daysBetween('2023-02-28', '2023-03-01')).toBe(1); // non-leap
  });
  test('is sign-aware', () => {
    expect(_daysBetween('2024-02-01', '2024-01-01')).toBe(-31);
  });
});

describe('_toSequenceLetter', () => {
  test('maps 0..25 to A..Z', () => {
    expect(_toSequenceLetter(0)).toBe('A');
    expect(_toSequenceLetter(25)).toBe('Z');
  });
  test('wraps to double letters after Z', () => {
    expect(_toSequenceLetter(26)).toBe('AA');
    expect(_toSequenceLetter(27)).toBe('AB');
  });
});

describe('inferSeasons — basic clustering', () => {
  test('empty or invalid inputs → empty array', () => {
    expect(inferSeasons([])).toEqual([]);
    expect(inferSeasons(null)).toEqual([]);
    expect(inferSeasons(undefined)).toEqual([]);
  });

  test('single cluster above thresholds → one season', () => {
    // 6 cosechas cada 10 días, rango 50 días → pasa todos los filtros.
    const records = [
      { fecha: '2024-01-01', cantidad: 100 },
      { fecha: '2024-01-11', cantidad: 100 },
      { fecha: '2024-01-21', cantidad: 100 },
      { fecha: '2024-01-31', cantidad: 100 },
      { fecha: '2024-02-10', cantidad: 100 },
      { fecha: '2024-02-20', cantidad: 100 },
    ];
    const out = inferSeasons(records);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      nombre: '2024-A',
      fechaInicio: '2024-01-01',
      fechaFin: '2024-02-20',
      autoDetected: true,
      nRegistros: 6,
      totalKg: 600,
    });
  });

  test('gap ≥ gapDays splits clusters', () => {
    // Dos clusters con registros espaciados ≤ 25 días (bajo gapDays=30 default),
    // separados entre sí por un hueco > 30 días.
    const records = [
      { fecha: '2024-01-01', cantidad: 50 },
      { fecha: '2024-01-20', cantidad: 50 },
      { fecha: '2024-02-15', cantidad: 50 },
      // gap of ~60 days
      { fecha: '2024-04-15', cantidad: 50 },
      { fecha: '2024-05-05', cantidad: 50 },
      { fecha: '2024-06-02', cantidad: 50 },
    ];
    const out = inferSeasons(records);
    expect(out).toHaveLength(2);
    expect(out[0].nombre).toBe('2024-A');
    expect(out[1].nombre).toBe('2024-B');
    expect(out[0].fechaFin < out[1].fechaInicio).toBe(true);
  });
});

describe('inferSeasons — thresholds', () => {
  test('cluster shorter than minLengthDays is discarded', () => {
    // 3 cosechas en 10 días (< 45 días default).
    const records = [
      { fecha: '2024-01-01', cantidad: 100 },
      { fecha: '2024-01-05', cantidad: 100 },
      { fecha: '2024-01-10', cantidad: 100 },
    ];
    expect(inferSeasons(records)).toEqual([]);
  });

  test('cluster with fewer than minRecords is discarded', () => {
    // 2 cosechas, rango 50 días, default minRecords=3.
    const records = [
      { fecha: '2024-01-01', cantidad: 100 },
      { fecha: '2024-02-20', cantidad: 100 },
    ];
    expect(inferSeasons(records)).toEqual([]);
  });

  test('custom options override defaults', () => {
    const records = [
      { fecha: '2024-01-01', cantidad: 100 },
      { fecha: '2024-01-10', cantidad: 100 },
    ];
    // Aflojamos a minRecords=2, minLengthDays=5 → pasa.
    const out = inferSeasons(records, { minRecords: 2, minLengthDays: 5 });
    expect(out).toHaveLength(1);
    expect(out[0].nRegistros).toBe(2);
  });
});

describe('inferSeasons — data filtering', () => {
  test('ignores records with invalid fecha', () => {
    // Cluster válido: 01-01, 01-20, 02-15 (46 días, 3 registros, sin huecos ≥30).
    // Mezclado con registros inválidos que deberían descartarse.
    const records = [
      { fecha: '2024-01-01', cantidad: 100 },
      { fecha: 'invalid', cantidad: 100 },
      { fecha: null, cantidad: 100 },
      { fecha: '2024-01-20', cantidad: 100 },
      { fecha: '2024-02-15', cantidad: 100 },
    ];
    const out = inferSeasons(records);
    expect(out).toHaveLength(1);
    expect(out[0].nRegistros).toBe(3);
  });

  test('ignores records with cantidad <= 0', () => {
    const records = [
      { fecha: '2024-01-01', cantidad: 100 },
      { fecha: '2024-01-10', cantidad: 0 },
      { fecha: '2024-01-20', cantidad: -50 },
      { fecha: '2024-01-25', cantidad: 100 },
      { fecha: '2024-02-15', cantidad: 100 },
    ];
    const out = inferSeasons(records);
    expect(out).toHaveLength(1);
    expect(out[0].nRegistros).toBe(3);
    expect(out[0].totalKg).toBe(300);
  });
});

describe('inferSeasons — multi-year naming', () => {
  test('names reset per year', () => {
    const records = [
      // 2023-A: 3 registros, rango 45 días, gaps internos ≤ 26 días
      { fecha: '2023-01-01', cantidad: 50 },
      { fecha: '2023-01-20', cantidad: 50 },
      { fecha: '2023-02-15', cantidad: 50 },
      // gap de ~75 días → separa temporadas
      { fecha: '2023-05-01', cantidad: 50 },
      { fecha: '2023-05-20', cantidad: 50 },
      { fecha: '2023-06-15', cantidad: 50 },
      // gap grande → 2024-A
      { fecha: '2024-01-05', cantidad: 50 },
      { fecha: '2024-01-25', cantidad: 50 },
      { fecha: '2024-02-20', cantidad: 50 },
    ];
    const out = inferSeasons(records);
    expect(out.map(s => s.nombre)).toEqual(['2023-A', '2023-B', '2024-A']);
  });
});

describe('inferSeasons — DEFAULTS exported', () => {
  test('are immutable', () => {
    expect(DEFAULTS).toEqual({ gapDays: 30, minLengthDays: 45, minRecords: 3 });
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
  });
});
