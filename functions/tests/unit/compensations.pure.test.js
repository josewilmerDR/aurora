/**
 * Unit tests for lib/autopilotCompensations.js#buildDescriptor.
 * Writer / executor / rollback flow are exercised in the integration tests.
 */

const { buildDescriptor } = require('../../lib/autopilotCompensations');

describe('buildDescriptor — maps actions to their inverse', () => {
  test('crear_tarea → delete_task(taskId)', () => {
    const d = buildDescriptor('crear_tarea', {}, { taskId: 't1' });
    expect(d.compensationType).toBe('delete_task');
    expect(d.params).toEqual({ taskId: 't1' });
  });

  test('reprogramar_tarea → set_task_date with oldExecuteAt from preExecState', () => {
    const preExec = { oldExecuteAt: { _seconds: 1000 } };
    const d = buildDescriptor('reprogramar_tarea', { taskId: 't2' }, {}, preExec);
    expect(d.compensationType).toBe('set_task_date');
    expect(d.params.taskId).toBe('t2');
    expect(d.params.executeAt).toBe(preExec.oldExecuteAt);
  });

  test('reasignar_tarea → set_task_user with oldResponsableId', () => {
    const d = buildDescriptor('reasignar_tarea', { taskId: 't3' }, {}, { oldResponsableId: 'user-42' });
    expect(d.compensationType).toBe('set_task_user');
    expect(d.params).toEqual({ taskId: 't3', userId: 'user-42' });
  });

  test('ajustar_inventario → set_product_stock with stockAnterior', () => {
    const d = buildDescriptor('ajustar_inventario', { productoId: 'p1' }, {}, { stockAnterior: 42 });
    expect(d.compensationType).toBe('set_product_stock');
    expect(d.params).toEqual({ productoId: 'p1', stockAnterior: 42 });
  });

  test('crear_solicitud_compra → cancel_solicitud with solicitudId + taskId', () => {
    const d = buildDescriptor('crear_solicitud_compra', {}, { solicitudId: 's1', taskId: 'task-s1' });
    expect(d.compensationType).toBe('cancel_solicitud');
    expect(d.params).toEqual({ solicitudId: 's1', taskId: 'task-s1' });
  });

  test('crear_orden_compra → cancel_orden with orderId', () => {
    const d = buildDescriptor('crear_orden_compra', {}, { orderId: 'oc1' });
    expect(d.compensationType).toBe('cancel_orden');
    expect(d.params).toEqual({ orderId: 'oc1' });
  });

  test('enviar_notificacion → not_compensable', () => {
    const d = buildDescriptor('enviar_notificacion', {}, {});
    expect(d.compensationType).toBe('not_compensable');
  });

  test('unknown action type defaults to not_compensable', () => {
    const d = buildDescriptor('some_future_type', {}, {});
    expect(d.compensationType).toBe('not_compensable');
  });
});
