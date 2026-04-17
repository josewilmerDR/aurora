/**
 * Autopilot action executor — transactional side effects.
 *
 * Each case wraps its side effect in a Firestore transaction together with
 * the write to `autopilot_actions`. If the side effect fails halfway, the
 * action-record write rolls back too, so we never end up with a successful
 * effect and no record, or a "status: executed" record whose effect never
 * landed.
 *
 * Twilio is not transactional, so `enviar_notificacion` uses a two-phase
 * pattern: mark the action as `pending_external` inside a transaction,
 * call Twilio, then update the action to `executed` or `failed`.
 *
 * Caller contract (when `actionDocRef` is provided):
 *   - On success: this module has written status='executed' (or
 *     'pending_external' then 'executed') atomically with the side effect.
 *   - On failure: this module has written status='failed' with the error
 *     message. The function still throws so the caller can branch on it.
 *   - Without `actionDocRef`: behaves as a pure side effect, nothing written.
 *
 * If `actionInitialDoc` is also passed, the doc is CREATED with those
 * initial fields merged with the outcome. Without it, the doc must already
 * exist and the outcome is applied via `update`.
 */

const { db, Timestamp, twilioWhatsappFrom } = require('./firebase');
const { getTwilioClient } = require('./clients');
const { isPaused: isAutopilotPaused } = require('./autopilotKillSwitch');
const { ERROR_CODES } = require('./errors');

class AutopilotPausedError extends Error {
  constructor(fincaId) {
    super(`Autopilot is paused for finca ${fincaId}.`);
    this.name = 'AutopilotPausedError';
    this.code = ERROR_CODES.AUTOPILOT_PAUSED;
  }
}

// ── Outcome helpers ─────────────────────────────────────────────────────────

/**
 * Writes a success outcome to the action doc within the current transaction.
 * Creates the doc when `actionInitialDoc` is provided, otherwise updates.
 */
function writeSuccessOutcome(t, ctx, result, startMs) {
  if (!ctx.actionDocRef) return;
  const outcome = {
    status: 'executed',
    executionResult: result,
    executedAt: Timestamp.now(),
    latencyMs: Date.now() - startMs,
  };
  if (ctx.actionInitialDoc) {
    t.set(ctx.actionDocRef, { ...ctx.actionInitialDoc, ...outcome });
  } else {
    t.update(ctx.actionDocRef, outcome);
  }
}

/**
 * Best-effort: records a failure on the action doc when the operation failed
 * before (or during) the atomic outcome write. Swallows its own errors —
 * if this write also fails, we log and move on.
 */
async function recordFailureBestEffort(ctx, err, startMs) {
  if (!ctx.actionDocRef) return;
  const failure = {
    status: 'failed',
    executionResult: { error: err.message || String(err) },
    executedAt: Timestamp.now(),
    latencyMs: Date.now() - startMs,
  };
  try {
    if (ctx.actionInitialDoc) {
      await ctx.actionDocRef.set({ ...ctx.actionInitialDoc, ...failure });
    } else {
      await ctx.actionDocRef.update(failure);
    }
  } catch (writeErr) {
    console.error('[AUTOPILOT] Failed to record failure outcome:', writeErr);
  }
}

/**
 * Wraps the full case body (validation + transaction) so any thrown error
 * — pre-transaction or in-transaction — results in a best-effort failure
 * record before the error is rethrown to the caller.
 */
async function withFailureRecording(ctx, fn) {
  const startMs = Date.now();
  try {
    return await fn(startMs);
  } catch (err) {
    await recordFailureBestEffort(ctx, err, startMs);
    throw err;
  }
}

// ── Case handlers ───────────────────────────────────────────────────────────

async function executeCrearTarea(params, fincaId, ctx) {
  return withFailureRecording(ctx, async (startMs) => {
    const { nombre, loteId, responsableId, fecha, productos } = params;
    const prodList = Array.isArray(productos) ? productos : [];

    return db.runTransaction(async (t) => {
      const taskRef = db.collection('scheduled_tasks').doc();
      t.set(taskRef, {
        type: prodList.length > 0 ? 'MANUAL_APLICACION' : 'MANUAL_NOTIFICACION',
        executeAt: Timestamp.fromDate(new Date(fecha + 'T08:00:00')),
        status: 'pending',
        loteId: loteId || null,
        fincaId,
        activity: {
          name: nombre,
          type: prodList.length > 0 ? 'aplicacion' : 'notificacion',
          responsableId: responsableId || null,
          productos: prodList.map(p => ({
            productoId: p.productoId,
            nombreComercial: p.nombreComercial || '',
            cantidad: parseFloat(p.cantidad) || 0,
            unidad: p.unidad || '',
          })),
        },
        createdByAutopilot: true,
      });
      const result = { ok: true, taskId: taskRef.id, nombre };
      writeSuccessOutcome(t, ctx, result, startMs);
      return result;
    });
  });
}

async function executeReprogramarTarea(params, fincaId, ctx) {
  return withFailureRecording(ctx, async (startMs) => {
    const { taskId, newDate } = params;
    return db.runTransaction(async (t) => {
      const taskRef = db.collection('scheduled_tasks').doc(taskId);
      const snap = await t.get(taskRef);
      if (!snap.exists) throw new Error('Document not found.');
      if (snap.data().fincaId !== fincaId) throw new Error('Access denied to this resource.');
      t.update(taskRef, {
        executeAt: Timestamp.fromDate(new Date(newDate + 'T08:00:00')),
      });
      const result = { ok: true, taskId, newDate };
      writeSuccessOutcome(t, ctx, result, startMs);
      return result;
    });
  });
}

async function executeReasignarTarea(params, fincaId, ctx) {
  return withFailureRecording(ctx, async (startMs) => {
    const { taskId, newUserId } = params;
    return db.runTransaction(async (t) => {
      const taskRef = db.collection('scheduled_tasks').doc(taskId);
      const snap = await t.get(taskRef);
      if (!snap.exists) throw new Error('Document not found.');
      const taskData = snap.data();
      if (taskData.fincaId !== fincaId) throw new Error('Access denied to this resource.');
      t.update(taskRef, {
        activity: { ...taskData.activity, responsableId: newUserId },
        status: 'pending',
      });
      const result = { ok: true, taskId, newUserId };
      writeSuccessOutcome(t, ctx, result, startMs);
      return result;
    });
  });
}

async function executeAjustarInventario(params, fincaId, ctx, options) {
  return withFailureRecording(ctx, async (startMs) => {
    const { productoId, stockNuevo, nota } = params;
    return db.runTransaction(async (t) => {
      const productRef = db.collection('productos').doc(productoId);
      const snap = await t.get(productRef);
      if (!snap.exists) throw new Error('Document not found.');
      const data = snap.data();
      if (data.fincaId !== fincaId) throw new Error('Access denied to this resource.');
      const stockAnterior = data.stockActual ?? 0;

      t.update(productRef, { stockActual: stockNuevo });
      const movRef = db.collection('movimientos').doc();
      t.set(movRef, {
        fincaId,
        productoId,
        tipo: 'ajuste_autopilot',
        cantidad: stockNuevo - stockAnterior,
        stockAnterior,
        stockNuevo,
        nota: nota || `Ajuste automático — Piloto Automático ${options.level || 'Nivel 2'}`,
        fecha: new Date(),
      });

      const result = { ok: true, productoId, stockAnterior, stockNuevo };
      writeSuccessOutcome(t, ctx, result, startMs);
      return result;
    });
  });
}

async function executeCrearSolicitudCompra(params, fincaId, ctx, options) {
  return withFailureRecording(ctx, async (startMs) => {
    const { items, responsableId, responsableNombre, notas } = params;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Se requiere al menos un producto en la solicitud.');
    }
    const mappedItems = items
      .map(i => ({
        productoId: i.productoId,
        nombreComercial: String(i.nombreComercial || '').slice(0, 64),
        cantidadSolicitada: parseFloat(i.cantidadSolicitada) || 0,
        unidad: String(i.unidad || '').slice(0, 40),
        stockActual: parseFloat(i.stockActual) || 0,
        stockMinimo: parseFloat(i.stockMinimo) || 0,
      }))
      .filter(i => i.cantidadSolicitada > 0 && i.cantidadSolicitada < 32768);
    if (mappedItems.length === 0) {
      throw new Error('Los productos deben tener cantidad mayor a 0.');
    }
    const resolvedResponsableId = responsableId || 'proveeduria';
    const resolvedResponsableNombre = String(responsableNombre || 'Proveeduría').slice(0, 128);
    const autopilotTag = `Piloto Automático ${options.level || ''}`.trim();

    return db.runTransaction(async (t) => {
      const solicitudRef = db.collection('solicitudes_compra').doc();
      t.set(solicitudRef, {
        fincaId,
        fechaCreacion: Timestamp.now(),
        estado: 'pendiente',
        responsableId: resolvedResponsableId,
        responsableNombre: resolvedResponsableNombre,
        notas: String(notas || `Creada por ${autopilotTag}`).slice(0, 288),
        items: mappedItems,
        createdByAutopilot: true,
      });
      const productosResumen = mappedItems
        .map(i => `${i.nombreComercial} (${i.cantidadSolicitada} ${i.unidad})`)
        .join(', ');
      const taskRef = db.collection('scheduled_tasks').doc();
      t.set(taskRef, {
        type: 'SOLICITUD_COMPRA',
        executeAt: Timestamp.now(),
        status: 'pending',
        loteId: null,
        fincaId,
        solicitudId: solicitudRef.id,
        activity: {
          name: `Solicitud de compra: ${mappedItems.length} producto(s)`,
          type: 'notificacion',
          responsableId: resolvedResponsableId,
          responsableNombre: resolvedResponsableNombre,
          descripcion: productosResumen,
          productos: mappedItems.map(i => ({
            productoId: i.productoId,
            nombreComercial: i.nombreComercial,
            cantidad: i.cantidadSolicitada,
            unidad: i.unidad,
            stockActual: i.stockActual,
            stockMinimo: i.stockMinimo,
          })),
        },
        notas: String(notas || '').slice(0, 288),
        createdByAutopilot: true,
      });

      const result = {
        ok: true,
        solicitudId: solicitudRef.id,
        taskId: taskRef.id,
        itemsCount: mappedItems.length,
      };
      writeSuccessOutcome(t, ctx, result, startMs);
      return result;
    });
  });
}

async function executeCrearOrdenCompra(params, fincaId, ctx, options) {
  return withFailureRecording(ctx, async (startMs) => {
    const { fecha, fechaEntrega, proveedor, direccionProveedor, elaboradoPor, notas, items, solicitudId } = params;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Se requiere al menos un producto en la orden.');
    }
    const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);
    const num = (v, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
      const n = parseFloat(v);
      if (!isFinite(n)) return 0;
      return Math.min(Math.max(n, min), max);
    };
    const isValidYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (fecha && !isValidYmd(fecha)) throw new Error('Fecha de orden inválida.');
    if (fechaEntrega && !isValidYmd(fechaEntrega)) throw new Error('Fecha de entrega inválida.');

    // Resolve related task BEFORE the transaction so we don't hold a cross-
    // collection query inside it. Firestore transactions disallow queries.
    let relatedTaskRef = null;
    if (solicitudId) {
      const solTaskSnap = await db.collection('scheduled_tasks')
        .where('solicitudId', '==', solicitudId)
        .where('fincaId', '==', fincaId)
        .limit(1)
        .get();
      if (!solTaskSnap.empty) relatedTaskRef = solTaskSnap.docs[0].ref;
    }

    const autopilotTag = `Piloto Automático ${options.level || ''}`.trim();
    const counterRef = db.collection('counters').doc(`oc_${fincaId}`);

    return db.runTransaction(async (t) => {
      // Counter read + OC insert + solicitud task update all atomic.
      const counterDoc = await t.get(counterRef);
      const seq = (counterDoc.exists ? (counterDoc.data().value || 0) : 0) + 1;
      const poNumber = `OC-${String(seq).padStart(6, '0')}`;

      t.set(counterRef, { value: seq }, { merge: true });

      const orderRef = db.collection('ordenes_compra').doc();
      t.set(orderRef, {
        fincaId,
        poNumber,
        fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
        fechaEntrega: fechaEntrega ? Timestamp.fromDate(new Date(fechaEntrega + 'T12:00:00')) : null,
        proveedor: str(proveedor, 200),
        direccionProveedor: str(direccionProveedor, 300),
        elaboradoPor: str(elaboradoPor, 120) || autopilotTag,
        notas: str(notas, 1000),
        estado: 'activa',
        taskId: null,
        solicitudId: solicitudId || null,
        items: items.map(i => ({
          productoId: i.productoId || null,
          nombreComercial: str(i.nombreComercial, 200),
          ingredienteActivo: str(i.ingredienteActivo, 200),
          cantidad: num(i.cantidad, { min: 0, max: 1e9 }),
          unidad: str(i.unidad, 20),
          precioUnitario: num(i.precioUnitario, { min: 0, max: 1e9 }),
          iva: num(i.iva, { min: 0, max: 100 }),
          moneda: str(i.moneda, 10) || 'USD',
        })),
        createdAt: Timestamp.now(),
        createdByAutopilot: true,
      });

      if (relatedTaskRef) {
        t.update(relatedTaskRef, {
          status: 'completed_by_user',
          completedAt: Timestamp.now(),
          ordenCompraId: orderRef.id,
        });
      }

      const result = { ok: true, orderId: orderRef.id, poNumber, itemsCount: items.length };
      writeSuccessOutcome(t, ctx, result, startMs);
      return result;
    });
  });
}

/**
 * Two-phase Twilio execution:
 *   1. Inside a tx: mark action doc as `pending_external`.
 *   2. Outside the tx: call Twilio.
 *   3. Update action doc to `executed` or `failed`.
 *
 * Guarantees we always have a record of the attempt at the cost of a possible
 * `pending_external` leak if the process crashes between 2 and 3. A future
 * cleanup cron can reconcile stale `pending_external` records.
 */
async function executeEnviarNotificacion(params, fincaId, ctx) {
  const { userId, mensaje, telefono } = params;
  const startMs = Date.now();

  // Phase 1: mark pending (transactional when we have an action doc)
  if (ctx.actionDocRef) {
    try {
      await db.runTransaction(async (t) => {
        const pending = { status: 'pending_external', externalStartedAt: Timestamp.now() };
        if (ctx.actionInitialDoc) {
          t.set(ctx.actionDocRef, { ...ctx.actionInitialDoc, ...pending });
        } else {
          t.update(ctx.actionDocRef, pending);
        }
      });
    } catch (err) {
      await recordFailureBestEffort(ctx, err, startMs);
      throw err;
    }
  }

  // Phase 2: Twilio call
  try {
    let phone = telefono;
    if (!phone) {
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) throw new Error('User not found.');
      phone = userDoc.data().telefono;
    }
    if (!phone) throw new Error('User has no phone number on file.');

    const client = getTwilioClient();
    const to = `whatsapp:${phone.replace(/\s+/g, '')}`;
    const from = `whatsapp:${twilioWhatsappFrom.value()}`;
    await client.messages.create({ body: mensaje, from, to });

    const result = { ok: true, userId, enviado: true };

    // Phase 3: mark executed
    if (ctx.actionDocRef) {
      await ctx.actionDocRef.update({
        status: 'executed',
        executionResult: result,
        executedAt: Timestamp.now(),
        latencyMs: Date.now() - startMs,
      });
    }
    return result;
  } catch (err) {
    // Phase 3b: mark failed
    await recordFailureBestEffort(ctx, err, startMs);
    throw err;
  }
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Main entry point. See the top-of-file docs for the caller contract.
 */
async function executeAutopilotAction(type, params, fincaId, options = {}) {
  // Defense-in-depth kill switch: even if a caller bypasses the route
  // middleware (cron, internal callers), no Autopilot-driven side effect runs
  // while the finca is paused.
  if (await isAutopilotPaused(fincaId)) {
    throw new AutopilotPausedError(fincaId);
  }

  const ctx = {
    actionDocRef: options.actionDocRef || null,
    actionInitialDoc: options.actionInitialDoc || null,
  };

  switch (type) {
    case 'crear_tarea':             return executeCrearTarea(params, fincaId, ctx);
    case 'reprogramar_tarea':       return executeReprogramarTarea(params, fincaId, ctx);
    case 'reasignar_tarea':         return executeReasignarTarea(params, fincaId, ctx);
    case 'ajustar_inventario':      return executeAjustarInventario(params, fincaId, ctx, options);
    case 'enviar_notificacion':     return executeEnviarNotificacion(params, fincaId, ctx);
    case 'crear_solicitud_compra':  return executeCrearSolicitudCompra(params, fincaId, ctx, options);
    case 'crear_orden_compra':      return executeCrearOrdenCompra(params, fincaId, ctx, options);
    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

module.exports = {
  executeAutopilotAction,
  AutopilotPausedError,
};
