// Unit tests for HR action caps. Pure.
//
// These tests are critical — they verify that no HR action ever gets
// elevated to nivel3, regardless of what the caller requests. Every
// action type in FORBIDDEN_AT_NIVEL3 must have an explicit assertion.

const {
  HR_ACTION_TYPES,
  FORBIDDEN_AT_NIVEL3,
  capHrActionLevel,
  isHrActionType,
} = require('../../lib/hr/hrActionCaps');

describe('HR_ACTION_TYPES', () => {
  test('includes the five declared HR action types', () => {
    expect(HR_ACTION_TYPES).toEqual(expect.arrayContaining([
      'sugerir_contratacion',
      'sugerir_despido',
      'sugerir_sancion',
      'sugerir_memorando',
      'sugerir_revision_desempeno',
    ]));
  });

  test('is frozen', () => {
    expect(Object.isFrozen(HR_ACTION_TYPES)).toBe(true);
  });
});

describe('FORBIDDEN_AT_NIVEL3', () => {
  test('contains every HR action type', () => {
    for (const t of HR_ACTION_TYPES) {
      expect(FORBIDDEN_AT_NIVEL3.has(t)).toBe(true);
    }
  });

  test('is a Set instance', () => {
    expect(FORBIDDEN_AT_NIVEL3).toBeInstanceOf(Set);
  });
});

describe('capHrActionLevel — explicit case per forbidden action', () => {
  // Cada acción prohibida debe aparecer aquí con aserción propia. Agregar un
  // nuevo tipo a FORBIDDEN_AT_NIVEL3 sin un caso en este describe es un bug
  // del contributor — este test no lo detectará directamente, por eso el
  // test anterior en FORBIDDEN_AT_NIVEL3 itera sobre HR_ACTION_TYPES.

  test('sugerir_contratacion nivel3 → nivel2', () => {
    expect(capHrActionLevel('sugerir_contratacion', 'nivel3')).toBe('nivel2');
  });

  test('sugerir_despido nivel3 → nivel2', () => {
    expect(capHrActionLevel('sugerir_despido', 'nivel3')).toBe('nivel2');
  });

  test('sugerir_sancion nivel3 → nivel2', () => {
    expect(capHrActionLevel('sugerir_sancion', 'nivel3')).toBe('nivel2');
  });

  test('sugerir_memorando nivel3 → nivel2', () => {
    expect(capHrActionLevel('sugerir_memorando', 'nivel3')).toBe('nivel2');
  });

  test('sugerir_revision_desempeno nivel3 → nivel2', () => {
    expect(capHrActionLevel('sugerir_revision_desempeno', 'nivel3')).toBe('nivel2');
  });
});

describe('capHrActionLevel — pass-through cases', () => {
  test('HR action at nivel1 passes through', () => {
    expect(capHrActionLevel('sugerir_contratacion', 'nivel1')).toBe('nivel1');
  });

  test('HR action at nivel2 passes through', () => {
    expect(capHrActionLevel('sugerir_contratacion', 'nivel2')).toBe('nivel2');
  });

  test('HR action at off passes through', () => {
    expect(capHrActionLevel('sugerir_contratacion', 'off')).toBe('off');
  });

  test('non-HR action type passes through even at nivel3', () => {
    expect(capHrActionLevel('crear_orden_compra', 'nivel3')).toBe('nivel3');
    expect(capHrActionLevel('reasignar_presupuesto', 'nivel3')).toBe('nivel3');
  });

  test('unknown action at nivel3 passes through (not an HR concern)', () => {
    expect(capHrActionLevel('unknown_action', 'nivel3')).toBe('nivel3');
  });
});

describe('isHrActionType', () => {
  test('true for HR action types', () => {
    expect(isHrActionType('sugerir_contratacion')).toBe(true);
    expect(isHrActionType('sugerir_revision_desempeno')).toBe(true);
  });

  test('false for other action types', () => {
    expect(isHrActionType('crear_orden_compra')).toBe(false);
    expect(isHrActionType('reasignar_presupuesto')).toBe(false);
    expect(isHrActionType('crear_tarea')).toBe(false);
  });

  test('false for undefined/null/empty', () => {
    expect(isHrActionType(undefined)).toBe(false);
    expect(isHrActionType(null)).toBe(false);
    expect(isHrActionType('')).toBe(false);
  });
});
