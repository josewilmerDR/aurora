// Unit tests for rotationGuardrails. Pure — no Firestore, no Claude.

const {
  validateRotationProposal,
  _isValidIso,
  _daysBetween,
  _isIncompatible,
} = require('../../lib/strategy/rotationGuardrails');

// ─── Helpers ──────────────────────────────────────────────────────────────

function baseConstraintsByCultivo() {
  return {
    tomate: {
      cultivo: 'Tomate',
      familiaBotanica: 'Solanaceae',
      descansoMinCiclos: 2,
      descansoMinDias: 30,
      incompatibleCon: ['papa'],
    },
    papa: {
      cultivo: 'Papa',
      familiaBotanica: 'Solanaceae',
      descansoMinCiclos: 2,
      descansoMinDias: 30,
      incompatibleCon: [],
    },
    lechuga: {
      cultivo: 'Lechuga',
      familiaBotanica: 'Asteraceae',
      descansoMinCiclos: 0,
      descansoMinDias: 0,
      incompatibleCon: [],
    },
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

describe('_isValidIso', () => {
  test('accepts valid', () => {
    expect(_isValidIso('2024-07-15')).toBe(true);
    expect(_isValidIso('2020-02-29')).toBe(true);
  });
  test('rejects invalid', () => {
    expect(_isValidIso('2024-13-01')).toBe(false);
    expect(_isValidIso('24-01-01')).toBe(false);
    expect(_isValidIso(null)).toBe(false);
  });
});

describe('_daysBetween', () => {
  test('counts days correctly', () => {
    expect(_daysBetween('2024-01-01', '2024-02-01')).toBe(31);
    expect(_daysBetween('2024-02-28', '2024-03-01')).toBe(2); // leap year
  });
});

describe('_isIncompatible', () => {
  test('case insensitive match', () => {
    expect(_isIncompatible(['Papa', 'Berenjena'], 'papa')).toBe(true);
    expect(_isIncompatible(['Papa'], 'Lechuga')).toBe(false);
    expect(_isIncompatible([], 'X')).toBe(false);
    expect(_isIncompatible(null, 'X')).toBe(false);
  });
});

// ─── validateRotationProposal ─────────────────────────────────────────────

describe('validateRotationProposal — empty/invalid inputs', () => {
  test('empty propuestas → not allowed', () => {
    const out = validateRotationProposal({ propuestas: [] });
    expect(out.allowed).toBe(false);
    expect(out.violations[0].code).toBe('EMPTY_PROPOSAL');
  });

  test('invalid date → INVALID_DATE', () => {
    const out = validateRotationProposal({
      propuestas: [{ orden: 1, cultivo: 'Lechuga', fechaSiembra: 'invalid' }],
    });
    expect(out.allowed).toBe(false);
    expect(out.violations.some(v => v.code === 'INVALID_DATE')).toBe(true);
  });
});

describe('validateRotationProposal — R5 ORDEN_FECHAS', () => {
  test('descending dates → ORDEN_FECHAS', () => {
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Lechuga', fechaSiembra: '2024-06-01' },
        { orden: 2, cultivo: 'Tomate', fechaSiembra: '2024-05-01' },
      ],
    });
    expect(out.allowed).toBe(false);
    expect(out.violations.some(v => v.code === 'ORDEN_FECHAS')).toBe(true);
  });

  test('equal dates → ORDEN_FECHAS', () => {
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Lechuga', fechaSiembra: '2024-06-01' },
        { orden: 2, cultivo: 'Tomate', fechaSiembra: '2024-06-01' },
      ],
    });
    expect(out.violations.some(v => v.code === 'ORDEN_FECHAS')).toBe(true);
  });

  test('ascending dates pass R5', () => {
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Lechuga', familiaBotanica: 'Asteraceae', fechaSiembra: '2024-06-01' },
        { orden: 2, cultivo: 'Tomate', familiaBotanica: 'Solanaceae', fechaSiembra: '2024-12-01' },
      ],
    });
    // No ORDEN_FECHAS; puede haber otras si los constraints aplican.
    expect(out.violations.some(v => v.code === 'ORDEN_FECHAS')).toBe(false);
  });
});

describe('validateRotationProposal — R1 FAMILIA_CONSECUTIVA', () => {
  test('does NOT violate when descansoMinCiclos=0', () => {
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Lechuga', familiaBotanica: 'Asteraceae', fechaSiembra: '2024-06-01' },
      ],
      constraintsByCultivo: baseConstraintsByCultivo(),
    });
    expect(out.violations.some(v => v.code === 'FAMILIA_CONSECUTIVA')).toBe(false);
  });

  test('violates when N consecutive same family exceed cap', () => {
    const constraints = baseConstraintsByCultivo(); // Tomate descansoMinCiclos=2
    const out = validateRotationProposal({
      propuestas: [
        // Propuesta 3 es Tomate (Solanaceae) y los 2 ciclos previos también lo son.
        { orden: 1, cultivo: 'Tomate', familiaBotanica: 'Solanaceae', fechaSiembra: '2024-01-01' },
        { orden: 2, cultivo: 'Tomate', familiaBotanica: 'Solanaceae', fechaSiembra: '2024-06-01' },
        { orden: 3, cultivo: 'Tomate', familiaBotanica: 'Solanaceae', fechaSiembra: '2024-12-01' },
      ],
      constraintsByCultivo: constraints,
    });
    expect(out.allowed).toBe(false);
    expect(out.violations.some(v => v.code === 'FAMILIA_CONSECUTIVA')).toBe(true);
  });

  test('includes historial in the chain', () => {
    const constraints = baseConstraintsByCultivo();
    const out = validateRotationProposal({
      propuestas: [
        // Propuesta 1 es Tomate. Los 2 ciclos previos (historial) eran Tomate.
        { orden: 1, cultivo: 'Tomate', familiaBotanica: 'Solanaceae', fechaSiembra: '2025-01-01' },
      ],
      constraintsByCultivo: constraints,
      historial: [
        { fecha: '2024-06-01', cultivo: 'Tomate', familiaBotanica: 'Solanaceae', cerrado: true, fechaCierre: '2024-12-01' },
        { fecha: '2023-12-01', cultivo: 'Tomate', familiaBotanica: 'Solanaceae', cerrado: true, fechaCierre: '2024-05-01' },
      ],
    });
    expect(out.violations.some(v => v.code === 'FAMILIA_CONSECUTIVA')).toBe(true);
  });
});

describe('validateRotationProposal — R2 DESCANSO_DIAS', () => {
  test('violates when gap after previous cycle is less than descansoMinDias', () => {
    const constraints = baseConstraintsByCultivo();
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Tomate', familiaBotanica: 'Solanaceae', fechaSiembra: '2024-06-10' },
      ],
      constraintsByCultivo: constraints,
      historial: [
        { fecha: '2024-01-01', cultivo: 'Tomate', familiaBotanica: 'Solanaceae', cerrado: true, fechaCierre: '2024-06-01' },
      ],
    });
    expect(out.allowed).toBe(false);
    expect(out.violations.some(v => v.code === 'DESCANSO_DIAS')).toBe(true);
  });

  test('passes when gap is enough', () => {
    const constraints = baseConstraintsByCultivo();
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Tomate', familiaBotanica: 'Solanaceae', fechaSiembra: '2024-08-01' },
      ],
      constraintsByCultivo: constraints,
      historial: [
        { fecha: '2024-01-01', cultivo: 'Lechuga', familiaBotanica: 'Asteraceae', cerrado: true, fechaCierre: '2024-06-01' },
      ],
    });
    expect(out.violations.some(v => v.code === 'DESCANSO_DIAS')).toBe(false);
  });
});

describe('validateRotationProposal — R3 INCOMPATIBILIDAD', () => {
  test('blocks incompatible pair via previous cycle constraint', () => {
    const constraints = baseConstraintsByCultivo(); // Tomate incompatible con Papa
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Papa', familiaBotanica: 'Solanaceae', fechaSiembra: '2024-10-01' },
      ],
      constraintsByCultivo: constraints,
      historial: [
        { fecha: '2024-01-01', cultivo: 'Tomate', familiaBotanica: 'Solanaceae', cerrado: true, fechaCierre: '2024-06-01' },
      ],
    });
    expect(out.violations.some(v => v.code === 'INCOMPATIBILIDAD')).toBe(true);
  });

  test('no violation when previous cultivo has no incompatibilities listed', () => {
    const constraints = baseConstraintsByCultivo();
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Tomate', familiaBotanica: 'Solanaceae', fechaSiembra: '2025-01-01' },
      ],
      constraintsByCultivo: constraints,
      historial: [
        { fecha: '2024-01-01', cultivo: 'Lechuga', familiaBotanica: 'Asteraceae', cerrado: true, fechaCierre: '2024-06-01' },
      ],
    });
    expect(out.violations.some(v => v.code === 'INCOMPATIBILIDAD')).toBe(false);
  });
});

describe('validateRotationProposal — R4 OVERLAP_ACTIVO', () => {
  test('warns when lote has an active siembra', () => {
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Lechuga', familiaBotanica: 'Asteraceae', fechaSiembra: '2024-10-01' },
      ],
      activeSiembras: [{ id: 's-123', cerrado: false }],
    });
    const warn = out.violations.find(v => v.code === 'OVERLAP_ACTIVO');
    expect(warn).toBeTruthy();
    expect(warn.severity).toBe('warn');
    // Warn no bloquea.
    expect(out.allowed).toBe(true);
  });
});

describe('validateRotationProposal — R6 MONTHLY_CAP', () => {
  test('blocks when nivel3 run would exceed monthly cap', () => {
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Lechuga', familiaBotanica: 'Asteraceae', fechaSiembra: '2024-06-01' },
        { orden: 2, cultivo: 'Tomate', familiaBotanica: 'Solanaceae', fechaSiembra: '2024-12-01' },
      ],
      mode: 'nivel3',
      monthlyExecutionsCount: 9,
      maxMonthlyExecutions: 10,
    });
    expect(out.allowed).toBe(false);
    expect(out.violations.some(v => v.code === 'MONTHLY_CAP')).toBe(true);
  });

  test('does not apply cap in plan mode', () => {
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Lechuga', familiaBotanica: 'Asteraceae', fechaSiembra: '2024-06-01' },
      ],
      mode: 'plan',
      monthlyExecutionsCount: 999,
      maxMonthlyExecutions: 10,
    });
    expect(out.violations.some(v => v.code === 'MONTHLY_CAP')).toBe(false);
  });
});

describe('validateRotationProposal — happy path', () => {
  test('valid alternating plan with historial passes', () => {
    const constraints = baseConstraintsByCultivo();
    const out = validateRotationProposal({
      propuestas: [
        { orden: 1, cultivo: 'Lechuga', familiaBotanica: 'Asteraceae', fechaSiembra: '2024-08-01' },
        { orden: 2, cultivo: 'Tomate', familiaBotanica: 'Solanaceae', fechaSiembra: '2025-02-01' },
        { orden: 3, cultivo: 'Lechuga', familiaBotanica: 'Asteraceae', fechaSiembra: '2025-08-01' },
      ],
      constraintsByCultivo: constraints,
      historial: [
        { fecha: '2024-01-01', cultivo: 'Tomate', familiaBotanica: 'Solanaceae', cerrado: true, fechaCierre: '2024-05-01' },
      ],
    });
    expect(out.allowed).toBe(true);
  });
});
