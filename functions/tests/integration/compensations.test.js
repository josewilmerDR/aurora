/**
 * Integration: rollback flow via applyRollback().
 *
 * Strategy: for each action type that's compensable, execute the action
 * (setting up state), then invoke applyRollback and verify:
 *   - compensation status becomes 'applied'
 *   - action doc gets rolledBack=true
 *   - the side effect is reversed
 * Plus negative cases: not_compensable, already_applied, expired, blocked.
 */

jest.mock('../../lib/clients', () => ({
  getTwilioClient: () => ({
    messages: { create: jest.fn().mockResolvedValue({ sid: 'SM_ok' }) },
  }),
  getAnthropicClient: jest.fn(),
}));

const { db, Timestamp } = require('../../lib/firebase');
const { executeAutopilotAction } = require('../../lib/autopilotActions');
const { applyRollback } = require('../../lib/autopilotCompensations');
const {
  uniqueFincaId,
  newActionContext,
  readCompensation,
  cleanupFinca,
} = require('../helpers');

const actor = { uid: 'supervisor-1', email: 'sup@example.com' };

describe('applyRollback — per compensation type', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanupFinca)));

  test('rolls back crear_tarea by deleting the task', async () => {
    const fincaId = uniqueFincaId('rb_crear');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);
    const result = await executeAutopilotAction('crear_tarea', {
      nombre: 'Task', fecha: '2026-05-01', productos: [],
    }, fincaId, { actionDocRef, actionInitialDoc });

    const rb = await applyRollback(actionDocRef.id, fincaId, actor);
    expect(rb.ok).toBe(true);

    const task = await db.collection('scheduled_tasks').doc(result.taskId).get();
    expect(task.exists).toBe(false);

    const action = await actionDocRef.get();
    expect(action.data().rolledBack).toBe(true);

    const comp = await readCompensation(actionDocRef.id, fincaId);
    expect(comp.status).toBe('applied');
  });

  test('rolls back reprogramar_tarea by restoring old executeAt', async () => {
    const fincaId = uniqueFincaId('rb_reprog');
    fincas.push(fincaId);
    const oldDate = new Date('2026-01-01T08:00:00');
    const taskRef = db.collection('scheduled_tasks').doc();
    await taskRef.set({ fincaId, executeAt: oldDate, activity: { responsableId: 'u' }, status: 'pending' });

    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);
    await executeAutopilotAction('reprogramar_tarea', {
      taskId: taskRef.id, newDate: '2026-06-15',
    }, fincaId, { actionDocRef, actionInitialDoc });

    const rb = await applyRollback(actionDocRef.id, fincaId, actor);
    expect(rb.ok).toBe(true);

    const after = await taskRef.get();
    expect(after.data().executeAt.toDate().getTime()).toBe(oldDate.getTime());
  });

  test('rolls back ajustar_inventario by restoring stockAnterior', async () => {
    const fincaId = uniqueFincaId('rb_ajust');
    fincas.push(fincaId);
    const productRef = db.collection('productos').doc();
    await productRef.set({ fincaId, stockActual: 100, nombreComercial: 'X' });

    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);
    await executeAutopilotAction('ajustar_inventario', {
      productoId: productRef.id, stockNuevo: 42,
    }, fincaId, { actionDocRef, actionInitialDoc });

    const rb = await applyRollback(actionDocRef.id, fincaId, actor);
    expect(rb.ok).toBe(true);

    const after = await productRef.get();
    expect(after.data().stockActual).toBe(100);

    const movSnap = await db.collection('movimientos')
      .where('productoId', '==', productRef.id)
      .where('tipo', '==', 'rollback_autopilot').get();
    expect(movSnap.size).toBe(1);
  });

  test('rolls back crear_orden_compra by marking estado=anulada', async () => {
    const fincaId = uniqueFincaId('rb_oc');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);
    const result = await executeAutopilotAction('crear_orden_compra', {
      proveedor: 'X', fecha: '2026-04-17',
      items: [{ productoId: 'p', nombreComercial: 'x', cantidad: 1, precioUnitario: 10, unidad: 'kg' }],
    }, fincaId, { actionDocRef, actionInitialDoc });

    const rb = await applyRollback(actionDocRef.id, fincaId, actor);
    expect(rb.ok).toBe(true);

    const oc = await db.collection('ordenes_compra').doc(result.orderId).get();
    expect(oc.data().estado).toBe('anulada');
  });

  test('rolls back crear_solicitud_compra by marking estado=cancelada', async () => {
    const fincaId = uniqueFincaId('rb_sol');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);
    const result = await executeAutopilotAction('crear_solicitud_compra', {
      items: [{ productoId: 'p', nombreComercial: 'X', cantidadSolicitada: 5, unidad: 'kg' }],
    }, fincaId, { actionDocRef, actionInitialDoc });

    const rb = await applyRollback(actionDocRef.id, fincaId, actor);
    expect(rb.ok).toBe(true);

    const sol = await db.collection('solicitudes_compra').doc(result.solicitudId).get();
    expect(sol.data().estado).toBe('cancelada');
  });

  test('refuses to rollback enviar_notificacion (not_compensable)', async () => {
    const fincaId = uniqueFincaId('rb_notif');
    fincas.push(fincaId);
    const userRef = db.collection('users').doc();
    await userRef.set({ fincaId, telefono: '+573001234567' });

    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);
    await executeAutopilotAction('enviar_notificacion', {
      userId: userRef.id, mensaje: 'hi',
    }, fincaId, { actionDocRef, actionInitialDoc });

    const rb = await applyRollback(actionDocRef.id, fincaId, actor);
    expect(rb.ok).toBe(false);
    expect(rb.code).toBe('COMPENSATION_NOT_COMPENSABLE');
    await userRef.delete();
  });

  test('refuses to rollback twice (ALREADY_APPLIED or ALREADY_ROLLED_BACK)', async () => {
    const fincaId = uniqueFincaId('rb_twice');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);
    await executeAutopilotAction('crear_tarea', {
      nombre: 't', fecha: '2026-05-01', productos: [],
    }, fincaId, { actionDocRef, actionInitialDoc });

    const first = await applyRollback(actionDocRef.id, fincaId, actor);
    expect(first.ok).toBe(true);

    const second = await applyRollback(actionDocRef.id, fincaId, actor);
    expect(second.ok).toBe(false);
    expect(['ACTION_ALREADY_ROLLED_BACK', 'COMPENSATION_ALREADY_APPLIED']).toContain(second.code);
  });

  test('refuses to rollback expired compensation', async () => {
    const fincaId = uniqueFincaId('rb_expired');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);
    await executeAutopilotAction('crear_tarea', {
      nombre: 't', fecha: '2026-05-01', productos: [],
    }, fincaId, { actionDocRef, actionInitialDoc });

    // Manually expire the compensation
    const comp = await readCompensation(actionDocRef.id, fincaId);
    await comp.ref.update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });

    const rb = await applyRollback(actionDocRef.id, fincaId, actor);
    expect(rb.ok).toBe(false);
    expect(rb.code).toBe('COMPENSATION_EXPIRED');
  });

  test('refuses to rollback OC when estado has moved past "activa" (BLOCKED)', async () => {
    const fincaId = uniqueFincaId('rb_oc_blocked');
    fincas.push(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);
    const result = await executeAutopilotAction('crear_orden_compra', {
      proveedor: 'X', fecha: '2026-04-17',
      items: [{ productoId: 'p', nombreComercial: 'x', cantidad: 1, precioUnitario: 10, unidad: 'kg' }],
    }, fincaId, { actionDocRef, actionInitialDoc });

    // Simulate downstream state: someone marked the OC as "recibida"
    await db.collection('ordenes_compra').doc(result.orderId).update({ estado: 'recibida' });

    const rb = await applyRollback(actionDocRef.id, fincaId, actor);
    expect(rb.ok).toBe(false);
    expect(rb.code).toBe('COMPENSATION_BLOCKED');
    expect(rb.message).toMatch(/recibida/);
  });
});
