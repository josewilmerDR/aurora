/**
 * Integration: global guardrails that need Firestore aggregations.
 *
 *   - maxActionsPerDay: count executed autopilot_actions today
 *   - maxOrdenesCompraPerDay: count OCs today
 *   - maxOrdenesCompraMonthlyAmount: sum of month-to-date
 *   - maxNotificationsPerUserPerDay: per recipient userId
 */

const { db, Timestamp } = require('../../lib/firebase');
const { validateGuardrails } = require('../../lib/autopilotGuardrails');
const { uniqueFincaId, cleanupFinca } = require('../helpers');

async function seedExecutedAction(fincaId, extra = {}) {
  const ref = db.collection('autopilot_actions').doc();
  await ref.set({
    fincaId,
    status: 'executed',
    type: 'crear_tarea',
    createdAt: Timestamp.now(),
    ...extra,
  });
  return ref.id;
}

async function seedOrdenCompra(fincaId, amount) {
  const ref = db.collection('ordenes_compra').doc();
  await ref.set({
    fincaId,
    createdAt: Timestamp.now(),
    items: [{ cantidad: 1, precioUnitario: amount }],
  });
  return ref.id;
}

describe('validateGuardrails — global limits', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanupFinca)));

  test('blocks when maxActionsPerDay is reached', async () => {
    const fincaId = uniqueFincaId('g_daily');
    fincas.push(fincaId);
    await seedExecutedAction(fincaId);
    await seedExecutedAction(fincaId);

    const res = await validateGuardrails('crear_tarea', {}, {
      maxActionsPerDay: 2,
    }, { fincaId });

    expect(res.allowed).toBe(false);
    expect(res.violations.some(v => /diario/i.test(v))).toBe(true);
  });

  test('allows when maxActionsPerDay is not reached', async () => {
    const fincaId = uniqueFincaId('g_daily_ok');
    fincas.push(fincaId);
    await seedExecutedAction(fincaId);

    const res = await validateGuardrails('crear_tarea', {}, {
      maxActionsPerDay: 5,
    }, { fincaId });

    expect(res.allowed).toBe(true);
  });

  test('blocks OC creation when maxOrdenesCompraPerDay reached', async () => {
    const fincaId = uniqueFincaId('g_oc_day');
    fincas.push(fincaId);
    await seedOrdenCompra(fincaId, 100);
    await seedOrdenCompra(fincaId, 100);

    const res = await validateGuardrails('crear_orden_compra', {
      items: [{ cantidad: 1, precioUnitario: 50 }],
    }, { maxOrdenesCompraPerDay: 2 }, { fincaId });

    expect(res.allowed).toBe(false);
    expect(res.violations.some(v => /órdenes de compra/i.test(v))).toBe(true);
  });

  test('blocks OC when (month-to-date + this OC) exceeds monthly cap', async () => {
    const fincaId = uniqueFincaId('g_oc_month');
    fincas.push(fincaId);
    await seedOrdenCompra(fincaId, 2500);
    await seedOrdenCompra(fincaId, 2500);

    // month-to-date = $5000; this OC $500 → $5500 > limit $5000 → blocked
    const res = await validateGuardrails('crear_orden_compra', {
      items: [{ cantidad: 1, precioUnitario: 500 }],
    }, { maxOrdenesCompraMonthlyAmount: 5000 }, { fincaId });

    expect(res.allowed).toBe(false);
    expect(res.violations.some(v => /mensual/i.test(v))).toBe(true);
  });

  test('blocks notifications per user when daily cap hit', async () => {
    const fincaId = uniqueFincaId('g_notif');
    fincas.push(fincaId);
    await seedExecutedAction(fincaId, {
      type: 'enviar_notificacion',
      params: { userId: 'trabajador-a' },
    });
    await seedExecutedAction(fincaId, {
      type: 'enviar_notificacion',
      params: { userId: 'trabajador-a' },
    });

    const res = await validateGuardrails('enviar_notificacion', {
      userId: 'trabajador-a',
    }, { maxNotificationsPerUserPerDay: 2 }, { fincaId });

    expect(res.allowed).toBe(false);
    expect(res.violations.some(v => /notificaciones/i.test(v))).toBe(true);

    // A different user is unaffected
    const other = await validateGuardrails('enviar_notificacion', {
      userId: 'trabajador-b',
    }, { maxNotificationsPerUserPerDay: 2 }, { fincaId });
    expect(other.allowed).toBe(true);
  });

  test('aggregates multiple violations in a single response', async () => {
    const fincaId = uniqueFincaId('g_multi');
    fincas.push(fincaId);
    await seedExecutedAction(fincaId);

    const res = await validateGuardrails('enviar_notificacion', {}, {
      maxActionsPerDay: 1,
      allowedActionTypes: ['crear_tarea'], // blocks this type
    }, { fincaId });

    expect(res.allowed).toBe(false);
    expect(res.violations.length).toBeGreaterThanOrEqual(2);
  });
});
