/**
 * Autopilot compensations — rollback descriptors + executor.
 *
 * For every successful Autopilot side effect, we record its inverse operation
 * ("compensation") atomically with the action doc write. This gives an admin a
 * well-defined recovery path: call POST /api/autopilot/actions/:id/rollback and
 * the system applies the compensation transactionally.
 *
 * The executor path deliberately does NOT go through `executeAutopilotAction`:
 *   - It must work even when the Autopilot is paused (rollback is the
 *     recovery mechanism for a paused system).
 *   - Reverse operations are simpler than originals (no guardrails, no
 *     feed events, no LLM involvement).
 */

const { db, Timestamp } = require('./firebase');

const COLLECTION = 'autopilot_compensations';
const DEFAULT_TTL_DAYS = 7;

// ── Descriptor building ─────────────────────────────────────────────────────

/**
 * Returns a compensation descriptor given the executed action. The descriptor
 * is persisted by `writeCompensationInTx`. If an action is inherently
 * irreversible (e.g. a sent WhatsApp message), return compensationType
 * 'not_compensable' so the record still exists (for UI clarity) but cannot
 * be applied.
 *
 *   preExecState: data read during the action's own transaction that the
 *     inverse will need (e.g. the original executeAt before a reschedule).
 */
function buildDescriptor(actionType, params, executionResult, preExecState = {}) {
  switch (actionType) {
    case 'crear_tarea':
      return {
        compensationType: 'delete_task',
        params: { taskId: executionResult.taskId },
      };
    case 'reprogramar_tarea':
      return {
        compensationType: 'set_task_date',
        params: {
          taskId: params.taskId,
          executeAt: preExecState.oldExecuteAt || null, // Firestore Timestamp
        },
      };
    case 'reasignar_tarea':
      return {
        compensationType: 'set_task_user',
        params: {
          taskId: params.taskId,
          userId: preExecState.oldResponsableId ?? null,
        },
      };
    case 'ajustar_inventario':
      return {
        compensationType: 'set_product_stock',
        params: {
          productoId: params.productoId,
          stockAnterior: preExecState.stockAnterior ?? 0,
        },
      };
    case 'crear_solicitud_compra':
      return {
        compensationType: 'cancel_solicitud',
        params: {
          solicitudId: executionResult.solicitudId,
          taskId: executionResult.taskId || null,
        },
      };
    case 'crear_orden_compra':
      return {
        compensationType: 'cancel_orden',
        params: { orderId: executionResult.orderId },
      };
    case 'enviar_notificacion':
    default:
      return { compensationType: 'not_compensable', params: {} };
  }
}

// ── Transactional write (called during action execution) ────────────────────

/**
 * Writes the compensation record inside the caller's transaction. No-op if
 * `actionDocRef` is missing — compensations only make sense when there's an
 * action to compensate for.
 */
function writeCompensationInTx(t, {
  actionDocRef,
  actionType,
  descriptor,
  fincaId,
  ttlDays = DEFAULT_TTL_DAYS,
}) {
  if (!actionDocRef) return null;
  const compRef = db.collection(COLLECTION).doc();
  const now = Timestamp.now();
  const isCompensable = descriptor.compensationType !== 'not_compensable';
  const expiresAt = isCompensable
    ? Timestamp.fromMillis(now.toMillis() + ttlDays * 24 * 60 * 60 * 1000)
    : null;

  t.set(compRef, {
    actionId: actionDocRef.id,
    fincaId,
    originalActionType: actionType,
    compensationType: descriptor.compensationType,
    params: descriptor.params || {},
    status: isCompensable ? 'available' : 'not_compensable',
    createdAt: now,
    expiresAt,
    appliedAt: null,
    appliedBy: null,
    appliedByEmail: null,
  });
  return compRef;
}

// ── Rollback executor ───────────────────────────────────────────────────────

const RESULT_CODES = {
  NOT_FOUND: 'COMPENSATION_NOT_AVAILABLE',
  NOT_COMPENSABLE: 'COMPENSATION_NOT_COMPENSABLE',
  EXPIRED: 'COMPENSATION_EXPIRED',
  ALREADY_APPLIED: 'COMPENSATION_ALREADY_APPLIED',
  BLOCKED: 'COMPENSATION_BLOCKED',
  ACTION_NOT_FOUND: 'NOT_FOUND',
  ACTION_NOT_EXECUTED: 'ACTION_NOT_EXECUTED',
  ACTION_ALREADY_ROLLED_BACK: 'ACTION_ALREADY_ROLLED_BACK',
  EXECUTION_FAILED: 'INTERNAL_ERROR',
};

/**
 * Pre-transaction check for cross-collection invariants that would break the
 * rollback (e.g. an OC already received cannot be anulada). Kept outside the
 * transaction because Firestore transactions don't support queries.
 */
async function precheckCompensation(type, params, fincaId) {
  switch (type) {
    case 'cancel_orden': {
      const snap = await db.collection('ordenes_compra').doc(params.orderId).get();
      if (!snap.exists) return { ok: false, reason: 'Orden no encontrada.' };
      if (snap.data().fincaId !== fincaId) return { ok: false, reason: 'Orden no pertenece a esta finca.' };
      const estado = snap.data().estado;
      if (estado !== 'activa') {
        return { ok: false, reason: `La orden está en estado "${estado}" y no se puede anular.` };
      }
      return { ok: true };
    }
    case 'cancel_solicitud': {
      const snap = await db.collection('solicitudes_compra').doc(params.solicitudId).get();
      if (!snap.exists) return { ok: false, reason: 'Solicitud no encontrada.' };
      if (snap.data().fincaId !== fincaId) return { ok: false, reason: 'Solicitud no pertenece a esta finca.' };
      const estado = snap.data().estado;
      if (estado !== 'pendiente') {
        return { ok: false, reason: `La solicitud está en estado "${estado}" y no se puede cancelar.` };
      }
      return { ok: true };
    }
    case 'set_product_stock': {
      if ((params.stockAnterior ?? 0) < 0) {
        return { ok: false, reason: 'El stock previo era negativo; no se puede restaurar.' };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

/**
 * Applies the compensation's side effect inside the given transaction.
 * Throws if the target doc is missing or belongs to another finca.
 */
async function applyCompensationInTx(t, type, params, fincaId) {
  switch (type) {
    case 'delete_task': {
      const ref = db.collection('scheduled_tasks').doc(params.taskId);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('Tarea ya no existe.');
      if (snap.data().fincaId !== fincaId) throw new Error('Tarea no pertenece a esta finca.');
      t.delete(ref);
      return { ok: true, deletedTaskId: params.taskId };
    }
    case 'set_task_date': {
      const ref = db.collection('scheduled_tasks').doc(params.taskId);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('Tarea ya no existe.');
      if (snap.data().fincaId !== fincaId) throw new Error('Tarea no pertenece a esta finca.');
      if (!params.executeAt) throw new Error('Fecha previa no disponible en la compensación.');
      t.update(ref, { executeAt: params.executeAt });
      return { ok: true, taskId: params.taskId };
    }
    case 'set_task_user': {
      const ref = db.collection('scheduled_tasks').doc(params.taskId);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('Tarea ya no existe.');
      if (snap.data().fincaId !== fincaId) throw new Error('Tarea no pertenece a esta finca.');
      const activity = { ...snap.data().activity, responsableId: params.userId ?? null };
      t.update(ref, { activity });
      return { ok: true, taskId: params.taskId };
    }
    case 'set_product_stock': {
      const ref = db.collection('productos').doc(params.productoId);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('Producto ya no existe.');
      if (snap.data().fincaId !== fincaId) throw new Error('Producto no pertenece a esta finca.');
      const currentStock = snap.data().stockActual ?? 0;
      const targetStock = params.stockAnterior ?? 0;
      t.update(ref, { stockActual: targetStock });
      const movRef = db.collection('movimientos').doc();
      t.set(movRef, {
        fincaId,
        productoId: params.productoId,
        tipo: 'rollback_autopilot',
        cantidad: targetStock - currentStock,
        stockAnterior: currentStock,
        stockNuevo: targetStock,
        nota: 'Reversión de ajuste automático — Piloto Automático.',
        fecha: new Date(),
      });
      return { ok: true, productoId: params.productoId, stockRestaurado: targetStock };
    }
    case 'cancel_solicitud': {
      // Firestore transactions require all reads BEFORE any writes.
      const solRef = db.collection('solicitudes_compra').doc(params.solicitudId);
      const solSnap = await t.get(solRef);
      if (!solSnap.exists) throw new Error('Solicitud ya no existe.');
      if (solSnap.data().fincaId !== fincaId) throw new Error('Solicitud no pertenece a esta finca.');
      let taskRef = null;
      let taskExists = false;
      if (params.taskId) {
        taskRef = db.collection('scheduled_tasks').doc(params.taskId);
        const taskSnap = await t.get(taskRef);
        taskExists = taskSnap.exists && taskSnap.data().fincaId === fincaId;
      }
      // All writes after all reads.
      t.update(solRef, { estado: 'cancelada', canceladaAt: Timestamp.now() });
      if (taskExists) t.update(taskRef, { status: 'skipped' });
      return { ok: true, solicitudId: params.solicitudId };
    }
    case 'cancel_orden': {
      const ref = db.collection('ordenes_compra').doc(params.orderId);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('Orden ya no existe.');
      if (snap.data().fincaId !== fincaId) throw new Error('Orden no pertenece a esta finca.');
      t.update(ref, { estado: 'anulada', anuladaAt: Timestamp.now() });
      return { ok: true, orderId: params.orderId };
    }
    default:
      throw new Error(`Unknown compensation type: ${type}`);
  }
}

/**
 * Look up the compensation linked to an action.
 */
async function findByActionId(actionId, fincaId) {
  const snap = await db.collection(COLLECTION)
    .where('actionId', '==', actionId)
    .where('fincaId', '==', fincaId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ref: snap.docs[0].ref, ...snap.docs[0].data() };
}

/**
 * Full rollback flow. Returns one of:
 *   { ok: true, result }
 *   { ok: false, code, message? }
 *
 * Codes correspond to `ERROR_CODES` in lib/errors.js.
 */
async function applyRollback(actionId, fincaId, actor) {
  const actionRef = db.collection('autopilot_actions').doc(actionId);
  const actionSnap = await actionRef.get();
  if (!actionSnap.exists) return { ok: false, code: RESULT_CODES.ACTION_NOT_FOUND };
  const actionData = actionSnap.data();
  if (actionData.fincaId !== fincaId) return { ok: false, code: 'FORBIDDEN' };
  if (actionData.status !== 'executed') return { ok: false, code: RESULT_CODES.ACTION_NOT_EXECUTED };
  if (actionData.rolledBack) return { ok: false, code: RESULT_CODES.ACTION_ALREADY_ROLLED_BACK };

  const compensation = await findByActionId(actionId, fincaId);
  if (!compensation) return { ok: false, code: RESULT_CODES.NOT_FOUND };
  if (compensation.status === 'applied') return { ok: false, code: RESULT_CODES.ALREADY_APPLIED };
  if (compensation.status === 'not_compensable') return { ok: false, code: RESULT_CODES.NOT_COMPENSABLE };
  if (compensation.status === 'expired') return { ok: false, code: RESULT_CODES.EXPIRED };
  if (compensation.expiresAt && compensation.expiresAt.toMillis() < Date.now()) {
    return { ok: false, code: RESULT_CODES.EXPIRED };
  }

  const pre = await precheckCompensation(compensation.compensationType, compensation.params, fincaId);
  if (!pre.ok) return { ok: false, code: RESULT_CODES.BLOCKED, message: pre.reason };

  try {
    const result = await db.runTransaction(async (t) => {
      const sideEffect = await applyCompensationInTx(
        t,
        compensation.compensationType,
        compensation.params,
        fincaId,
      );
      const now = Timestamp.now();
      t.update(compensation.ref, {
        status: 'applied',
        appliedAt: now,
        appliedBy: actor.uid || null,
        appliedByEmail: actor.email || null,
      });
      t.update(actionRef, {
        rolledBack: true,
        rolledBackAt: now,
        rolledBackBy: actor.uid || null,
        rolledBackByEmail: actor.email || null,
      });
      return sideEffect;
    });
    return { ok: true, result };
  } catch (err) {
    console.error('[AUTOPILOT_COMPENSATION] Rollback failed:', err);
    return { ok: false, code: RESULT_CODES.EXECUTION_FAILED, message: err.message };
  }
}

module.exports = {
  buildDescriptor,
  writeCompensationInTx,
  applyRollback,
  findByActionId,
  DEFAULT_TTL_DAYS,
};
