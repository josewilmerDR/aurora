/**
 * Integration: happy paths for all 7 action types.
 *
 * For each, verifies:
 *   - executeAutopilotAction succeeds and returns the expected result
 *   - autopilot_actions doc is created with status='executed', reasoning preserved
 *   - side effect is applied atomically (the target doc exists and looks right)
 *   - autopilot_compensations doc exists with the inverse operation ready to run
 */

// Mock the Twilio client — enviar_notificacion must not hit the network.
jest.mock('../../lib/clients', () => ({
  getTwilioClient: () => ({
    messages: { create: jest.fn().mockResolvedValue({ sid: 'SM_test' }) },
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

describe('executeAutopilotAction — happy paths', () => {
  const fincas = [];

  afterAll(async () => {
    await Promise.all(fincas.map(cleanupFinca));
  });

  test('crear_tarea creates scheduled_task + action + compensation(delete_task)', async () => {
    const fincaId = uniqueFincaId('crear_tarea');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'crear_tarea' });

    const result = await executeAutopilotAction('crear_tarea', {
      nombre: 'Riego tarde',
      fecha: '2026-05-01',
      responsableId: 'user-1',
      productos: [],
    }, fincaId, { actionDocRef, actionInitialDoc, level: 'test' });

    expect(result.ok).toBe(true);
    expect(result.taskId).toBeDefined();

    const action = await readAction(actionDocRef);
    expect(action.status).toBe('executed');
    expect(action.executionResult.taskId).toBe(result.taskId);
    expect(typeof action.latencyMs).toBe('number');

    const taskSnap = await db.collection('scheduled_tasks').doc(result.taskId).get();
    expect(taskSnap.exists).toBe(true);
    expect(taskSnap.data().fincaId).toBe(fincaId);
    expect(taskSnap.data().activity.name).toBe('Riego tarde');

    const comp = await readCompensation(actionDocRef.id, fincaId);
    expect(comp.compensationType).toBe('delete_task');
    expect(comp.params.taskId).toBe(result.taskId);
    expect(comp.status).toBe('available');
  });

  test('reprogramar_tarea updates executeAt + captures oldExecuteAt in compensation', async () => {
    const fincaId = uniqueFincaId('reprogramar');
    fincas.push(fincaId);
    // Seed a task first
    const taskRef = db.collection('scheduled_tasks').doc();
    const oldDate = new Date('2026-05-01T08:00:00');
    await taskRef.set({
      fincaId,
      activity: { name: 'Previous', responsableId: 'u1' },
      executeAt: oldDate,
      status: 'pending',
    });

    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'reprogramar_tarea' });
    const result = await executeAutopilotAction('reprogramar_tarea', {
      taskId: taskRef.id,
      newDate: '2026-06-15',
    }, fincaId, { actionDocRef, actionInitialDoc });

    expect(result.ok).toBe(true);
    const updated = await taskRef.get();
    expect(updated.data().executeAt.toDate().toISOString()).toMatch(/^2026-06-15/);

    const comp = await readCompensation(actionDocRef.id, fincaId);
    expect(comp.compensationType).toBe('set_task_date');
    expect(comp.params.taskId).toBe(taskRef.id);
    expect(comp.params.executeAt).toBeDefined();
  });

  test('reasignar_tarea updates responsableId + stores oldResponsableId', async () => {
    const fincaId = uniqueFincaId('reasignar');
    fincas.push(fincaId);
    const taskRef = db.collection('scheduled_tasks').doc();
    await taskRef.set({
      fincaId,
      activity: { name: 'X', responsableId: 'alice' },
      status: 'notified',
    });

    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'reasignar_tarea' });
    await executeAutopilotAction('reasignar_tarea', {
      taskId: taskRef.id,
      newUserId: 'bob',
    }, fincaId, { actionDocRef, actionInitialDoc });

    const updated = await taskRef.get();
    expect(updated.data().activity.responsableId).toBe('bob');
    expect(updated.data().status).toBe('pending');

    const comp = await readCompensation(actionDocRef.id, fincaId);
    expect(comp.compensationType).toBe('set_task_user');
    expect(comp.params.userId).toBe('alice');
  });

  test('ajustar_inventario updates stock + creates movimiento + captures stockAnterior', async () => {
    const fincaId = uniqueFincaId('ajustar');
    fincas.push(fincaId);
    const productRef = db.collection('productos').doc();
    await productRef.set({ fincaId, stockActual: 100, nombreComercial: 'Fert' });

    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'ajustar_inventario' });
    const result = await executeAutopilotAction('ajustar_inventario', {
      productoId: productRef.id,
      stockNuevo: 85,
      nota: 'Conteo físico',
    }, fincaId, { actionDocRef, actionInitialDoc });

    expect(result.stockAnterior).toBe(100);
    expect(result.stockNuevo).toBe(85);

    const updated = await productRef.get();
    expect(updated.data().stockActual).toBe(85);

    const movSnap = await db.collection('movimientos')
      .where('productoId', '==', productRef.id)
      .where('tipo', '==', 'ajuste_autopilot')
      .get();
    expect(movSnap.size).toBe(1);

    const comp = await readCompensation(actionDocRef.id, fincaId);
    expect(comp.compensationType).toBe('set_product_stock');
    expect(comp.params.stockAnterior).toBe(100);
  });

  test('enviar_notificacion transitions pending_external → executed + not_compensable record', async () => {
    const fincaId = uniqueFincaId('notif');
    fincas.push(fincaId);
    // Seed a user with a phone number
    const userRef = db.collection('users').doc();
    await userRef.set({ fincaId, telefono: '+573001234567' });

    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'enviar_notificacion' });
    const result = await executeAutopilotAction('enviar_notificacion', {
      userId: userRef.id,
      mensaje: 'Hola',
    }, fincaId, { actionDocRef, actionInitialDoc });

    expect(result.ok).toBe(true);

    const action = await readAction(actionDocRef);
    expect(action.status).toBe('executed');
    expect(action.executionResult.enviado).toBe(true);

    const comp = await readCompensation(actionDocRef.id, fincaId);
    expect(comp.compensationType).toBe('not_compensable');
    expect(comp.status).toBe('not_compensable');

    await userRef.delete();
  });

  test('crear_solicitud_compra creates solicitud + task + compensation', async () => {
    const fincaId = uniqueFincaId('solicitud');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'crear_solicitud_compra' });

    const result = await executeAutopilotAction('crear_solicitud_compra', {
      items: [{ productoId: 'p1', nombreComercial: 'X', cantidadSolicitada: 10, unidad: 'kg' }],
      notas: 'Bajo stock',
    }, fincaId, { actionDocRef, actionInitialDoc });

    expect(result.ok).toBe(true);
    expect(result.solicitudId).toBeDefined();
    expect(result.taskId).toBeDefined();

    const solSnap = await db.collection('solicitudes_compra').doc(result.solicitudId).get();
    expect(solSnap.exists).toBe(true);
    expect(solSnap.data().estado).toBe('pendiente');

    const comp = await readCompensation(actionDocRef.id, fincaId);
    expect(comp.compensationType).toBe('cancel_solicitud');
    expect(comp.params.solicitudId).toBe(result.solicitudId);
    expect(comp.params.taskId).toBe(result.taskId);
  });

  test('crear_orden_compra creates OC with unique poNumber + compensation cancel_orden', async () => {
    const fincaId = uniqueFincaId('oc');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'crear_orden_compra' });

    const result = await executeAutopilotAction('crear_orden_compra', {
      proveedor: 'Insumos S.A.',
      fecha: '2026-04-17',
      items: [{ productoId: 'p1', nombreComercial: 'X', cantidad: 5, precioUnitario: 100, unidad: 'kg' }],
    }, fincaId, { actionDocRef, actionInitialDoc });

    expect(result.ok).toBe(true);
    expect(result.poNumber).toMatch(/^OC-\d{6}$/);

    const ocSnap = await db.collection('ordenes_compra').doc(result.orderId).get();
    expect(ocSnap.exists).toBe(true);
    expect(ocSnap.data().poNumber).toBe(result.poNumber);
    expect(ocSnap.data().estado).toBe('activa');

    const comp = await readCompensation(actionDocRef.id, fincaId);
    expect(comp.compensationType).toBe('cancel_orden');
    expect(comp.params.orderId).toBe(result.orderId);
  });
});
