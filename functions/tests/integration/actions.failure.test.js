/**
 * Integration: failure paths for each action type.
 *
 * Verifies that when the side effect fails:
 *   - the error propagates to the caller
 *   - the autopilot_actions doc is recorded with status='failed' + error message
 *   - no side effect lands (no scheduled_tasks / productos / ordenes_compra)
 *   - no compensation record is created (only successes produce compensations)
 */

jest.mock('../../lib/clients', () => ({
  getTwilioClient: () => ({
    messages: { create: jest.fn().mockRejectedValue(new Error('twilio boom')) },
  }),
  getAnthropicClient: jest.fn(),
}));

const { db } = require('../../lib/firebase');
const { executeAutopilotAction } = require('../../lib/autopilotActions');
const {
  uniqueFincaId,
  newActionContext,
  readAction,
  readCompensation,
  cleanupFinca,
} = require('../helpers');

describe('executeAutopilotAction — failure paths', () => {
  const fincas = [];
  afterAll(async () => {
    await Promise.all(fincas.map(cleanupFinca));
  });

  test('crear_tarea with invalid fecha records status=failed', async () => {
    const fincaId = uniqueFincaId('fail_crear');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);

    await expect(executeAutopilotAction('crear_tarea', {
      nombre: 'x', fecha: 'not-a-date',
    }, fincaId, { actionDocRef, actionInitialDoc })).rejects.toThrow();

    const action = await readAction(actionDocRef);
    expect(action.status).toBe('failed');
    expect(action.executionResult.error).toBeTruthy();
    expect(await readCompensation(actionDocRef.id, fincaId)).toBeNull();
  });

  test('reprogramar_tarea on nonexistent task fails + leaves no side effect', async () => {
    const fincaId = uniqueFincaId('fail_reprog');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);

    await expect(executeAutopilotAction('reprogramar_tarea', {
      taskId: 'does-not-exist',
      newDate: '2026-01-01',
    }, fincaId, { actionDocRef, actionInitialDoc })).rejects.toThrow(/Document not found/);

    const action = await readAction(actionDocRef);
    expect(action.status).toBe('failed');
    expect(await readCompensation(actionDocRef.id, fincaId)).toBeNull();
  });

  test('reasignar_tarea on task belonging to another finca throws "Access denied"', async () => {
    const fincaA = uniqueFincaId('fail_reasig_a');
    const fincaB = uniqueFincaId('fail_reasig_b');
    fincas.push(fincaA, fincaB);
    const taskRef = db.collection('scheduled_tasks').doc();
    await taskRef.set({ fincaId: fincaA, activity: { responsableId: 'u1' } });

    const { actionDocRef, actionInitialDoc } = newActionContext(fincaB);
    await expect(executeAutopilotAction('reasignar_tarea', {
      taskId: taskRef.id, newUserId: 'u2',
    }, fincaB, { actionDocRef, actionInitialDoc })).rejects.toThrow(/Access denied/);

    const taskSnap = await taskRef.get();
    expect(taskSnap.data().activity.responsableId).toBe('u1'); // not mutated
    const action = await readAction(actionDocRef);
    expect(action.status).toBe('failed');
  });

  test('ajustar_inventario on missing product records failure', async () => {
    const fincaId = uniqueFincaId('fail_ajustar');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);

    await expect(executeAutopilotAction('ajustar_inventario', {
      productoId: 'ghost-product',
      stockNuevo: 50,
    }, fincaId, { actionDocRef, actionInitialDoc })).rejects.toThrow();

    const action = await readAction(actionDocRef);
    expect(action.status).toBe('failed');
    // No movimiento should have been written
    const movSnap = await db.collection('movimientos')
      .where('fincaId', '==', fincaId).get();
    expect(movSnap.size).toBe(0);
  });

  test('enviar_notificacion with missing user throws + records failure', async () => {
    const fincaId = uniqueFincaId('fail_notif');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);

    await expect(executeAutopilotAction('enviar_notificacion', {
      userId: 'ghost-user',
      mensaje: 'hi',
    }, fincaId, { actionDocRef, actionInitialDoc })).rejects.toThrow(/User not found/);

    const action = await readAction(actionDocRef);
    expect(action.status).toBe('failed');
  });

  test('crear_solicitud_compra with empty items throws validation error', async () => {
    const fincaId = uniqueFincaId('fail_solic');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);

    await expect(executeAutopilotAction('crear_solicitud_compra', {
      items: [],
    }, fincaId, { actionDocRef, actionInitialDoc })).rejects.toThrow(/al menos un producto/);

    const action = await readAction(actionDocRef);
    expect(action.status).toBe('failed');
  });

  test('crear_orden_compra with malformed date throws validation error', async () => {
    const fincaId = uniqueFincaId('fail_oc');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);

    await expect(executeAutopilotAction('crear_orden_compra', {
      items: [{ productoId: 'p', nombreComercial: 'x', cantidad: 1, precioUnitario: 10, unidad: 'kg' }],
      fecha: 'not-iso',
    }, fincaId, { actionDocRef, actionInitialDoc })).rejects.toThrow(/Fecha de orden inválida/);

    const action = await readAction(actionDocRef);
    expect(action.status).toBe('failed');

    // Counter was not consumed by a failed validation
    const counterSnap = await db.collection('counters').doc(`oc_${fincaId}`).get();
    expect(counterSnap.exists).toBe(false);
  });
});
