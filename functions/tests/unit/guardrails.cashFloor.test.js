// Unit tests for cash floor check. Pure.

const { checkCashFloor } = require('../../lib/finance/cashFloorCheck');

const base = {
  startingBalance: 10000,
  startingDate: '2026-04-20', // Monday
  baseEvents: [],
  proposedOutflow: { date: '2026-04-22', amount: 3000, label: 'OC test' },
  floor: 5000,
  horizonWeeks: 4,
  currency: 'USD',
};

describe('checkCashFloor', () => {
  test('passes when proposed outflow keeps balance above floor', () => {
    const out = checkCashFloor(base);
    expect(out.ok).toBe(true);
    // Saldo final: 10000 - 3000 = 7000, por encima del piso 5000
    expect(out.minBalance).toBe(7000);
  });

  test('blocks when proposed outflow drops balance below floor', () => {
    const out = checkCashFloor({ ...base, proposedOutflow: { date: '2026-04-22', amount: 6000 } });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/debajo del piso/i);
    expect(out.minBalance).toBe(4000);
  });

  test('considers base events (accumulated outflows)', () => {
    const out = checkCashFloor({
      ...base,
      baseEvents: [
        { date: '2026-04-21', amount: 4000, type: 'outflow', source: 'oc', label: 'OC-1' },
      ],
      proposedOutflow: { date: '2026-04-22', amount: 2000 },
    });
    // 10000 - 4000 - 2000 = 4000 < 5000
    expect(out.ok).toBe(false);
    expect(out.minBalance).toBe(4000);
  });

  test('considers base inflows that offset the proposed outflow', () => {
    // Partimos por encima del piso (6000 > 5000) para aislar el efecto
    // del offset. Sin el inflow la acción rompería el piso; con él se evita.
    const out = checkCashFloor({
      ...base,
      startingBalance: 6000,
      baseEvents: [
        { date: '2026-04-21', amount: 2000, type: 'inflow', source: 'income', label: 'cobro' },
      ],
      proposedOutflow: { date: '2026-04-22', amount: 2500 },
    });
    // 6000 + 2000 - 2500 = 5500 ≥ 5000
    expect(out.ok).toBe(true);

    // Control: sin el inflow sí rompe (6000 - 2500 = 3500 < 5000).
    const outWithoutInflow = checkCashFloor({
      ...base,
      startingBalance: 6000,
      baseEvents: [],
      proposedOutflow: { date: '2026-04-22', amount: 2500 },
    });
    expect(outWithoutInflow.ok).toBe(false);
  });

  test('permissive when floor is null/undefined', () => {
    expect(checkCashFloor({ ...base, floor: null }).ok).toBe(true);
    expect(checkCashFloor({ ...base, floor: undefined }).ok).toBe(true);
  });

  test('non-positive proposed amount is a no-op', () => {
    expect(checkCashFloor({ ...base, proposedOutflow: { date: '2026-04-22', amount: 0 } }).ok).toBe(true);
    expect(checkCashFloor({ ...base, proposedOutflow: { date: '2026-04-22', amount: -1 } }).ok).toBe(true);
  });

  test('respects floor below zero (sobregiro permitido)', () => {
    const out = checkCashFloor({
      ...base,
      startingBalance: 1000,
      proposedOutflow: { date: '2026-04-22', amount: 2000 },
      floor: -5000, // permite sobregiro hasta 5k
    });
    // 1000 - 2000 = -1000 ≥ -5000
    expect(out.ok).toBe(true);
  });

  test('uses configured horizon — event beyond horizon does not help', () => {
    const out = checkCashFloor({
      ...base,
      startingBalance: 1000,
      baseEvents: [
        // Entrada lejana fuera del horizonte de 4 semanas
        { date: '2026-06-15', amount: 10000, type: 'inflow', source: 'income', label: 'far' },
      ],
      proposedOutflow: { date: '2026-04-22', amount: 500 },
      floor: 5000,
      horizonWeeks: 4,
    });
    // En 4 semanas: 1000 - 500 = 500, inflow no cuenta → bloqueo
    expect(out.ok).toBe(false);
    expect(out.minBalance).toBe(500);
  });

  test('larger horizon picks up future inflow', () => {
    const out = checkCashFloor({
      ...base,
      startingBalance: 1000,
      baseEvents: [
        { date: '2026-06-15', amount: 10000, type: 'inflow', source: 'income', label: 'far' },
      ],
      proposedOutflow: { date: '2026-04-22', amount: 500 },
      floor: -5000, // acepta que baje a 500 temporalmente
      horizonWeeks: 12,
    });
    expect(out.ok).toBe(true);
  });
});
