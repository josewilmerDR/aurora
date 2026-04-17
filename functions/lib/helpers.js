const webpush = require('web-push');
const { db, Timestamp, FieldPath, APP_URL, twilioWhatsappFrom } = require('./firebase');
const { getTwilioClient } = require('./clients');
const { ERROR_CODES } = require('./errors');
const { isPaused: isAutopilotPaused } = require('./autopilotKillSwitch');

class AutopilotPausedError extends Error {
  constructor(fincaId) {
    super(`Autopilot is paused for finca ${fincaId}.`);
    this.name = 'AutopilotPausedError';
    this.code = ERROR_CODES.AUTOPILOT_PAUSED;
  }
}

// --- SECURITY HELPERS ---
const pick = (obj, fields) => fields.reduce((acc, f) => {
  if (obj[f] !== undefined) acc[f] = obj[f];
  return acc;
}, {});

const verifyOwnership = async (collection, docId, fincaId) => {
  const doc = await db.collection(collection).doc(docId).get();
  if (!doc.exists) {
    return { ok: false, status: 404, code: ERROR_CODES.NOT_FOUND, message: 'Document not found.' };
  }
  if (doc.data().fincaId !== fincaId) {
    return { ok: false, status: 403, code: ERROR_CODES.FORBIDDEN, message: 'Access denied to this resource.' };
  }
  return { ok: true, doc };
};

// --- ROLE HELPER ---
const ROLE_LEVELS_BE = { trabajador: 1, encargado: 2, supervisor: 3, rrhh: 3, administrador: 4 };
const hasMinRoleBE = (userRole, minRole) =>
  (ROLE_LEVELS_BE[userRole] || 0) >= (ROLE_LEVELS_BE[minRole] || 0);

// --- TASK ENRICHMENT ---
const enrichTask = async (taskDoc) => {
  const task = taskDoc.data();
  if (!task) return null;

  const responsableId = task.activity?.responsableId;
  const hasRealUser = responsableId && responsableId !== 'proveeduria';

  const sourcePromise = task.loteId
    ? db.collection('lotes').doc(task.loteId).get()
    : task.grupoId
    ? db.collection('grupos').doc(task.grupoId).get()
    : Promise.resolve(null);
  const userPromise = hasRealUser
    ? db.collection('users').doc(responsableId).get()
    : Promise.resolve(null);

  const [sourceDoc, userDoc] = await Promise.all([sourcePromise, userPromise]);

  const source = sourceDoc ? sourceDoc.data() : null;
  const responsable = userDoc ? userDoc.data() : null;

  let loteHectareas = parseFloat(source?.hectareas) || 1;
  if (task.grupoId && source) {
    const bloqueIds = (Array.isArray(task.bloques) && task.bloques.length > 0)
      ? task.bloques.slice(0, 10)
      : (Array.isArray(source.bloques) ? source.bloques.slice(0, 10) : []);
    if (bloqueIds.length > 0) {
      const siembrasSnap = await db.collection('siembras')
        .where(FieldPath.documentId(), 'in', bloqueIds)
        .get();
      const totalArea = siembrasSnap.docs.reduce(
        (s, d) => s + (parseFloat(d.data().areaCalculada) || 0), 0
      );
      if (totalArea > 0) loteHectareas = totalArea;
    }
  }

  return {
    id: taskDoc.id,
    activityName: task.activity?.name,
    loteName: source
      ? (source.nombreLote || source.nombreGrupo || '—')
      : (task.snap_grupoNombre || task.snap_loteNombre || ((task.loteId || task.grupoId) ? 'Eliminado' : '—')),
    loteHectareas,
    responsableName: responsable
      ? responsable.nombre
      : (task.activity?.responsableNombre || 'Proveeduría'),
    responsableTel: responsable ? responsable.telefono : '—',
    dueDate: task.executeAt?.toDate?.()?.toISOString() ?? null,
    status: task.status,
    type: task.type,
    ...task,
  };
};

// --- FEED HELPER ---
async function writeFeedEvent({ fincaId, uid, userEmail, eventType, activityType, title, loteNombre, userName: userNameOverride }) {
  try {
    let userName = userNameOverride || null;
    if (!userName && userEmail) {
      const userSnap = await db.collection('users')
        .where('email', '==', userEmail)
        .where('fincaId', '==', fincaId)
        .limit(1).get();
      userName = userSnap.empty ? userEmail : userSnap.docs[0].data().nombre;
    }
    if (!userName) userName = 'Sistema';

    await db.collection('feed').add({
      fincaId,
      uid: uid || 'system',
      userName,
      eventType,
      activityType: activityType || null,
      title,
      loteNombre: loteNombre || null,
      sensitive: false,
      timestamp: Timestamp.now(),
    });
  } catch (err) {
    console.error('[FEED] Error writing event:', err.message);
  }
}

// --- PUSH NOTIFICATION HELPER ---
async function sendPushToFincaRoles(fincaId, roles, { title, body, url }) {
  try {
    const usersSnap = await db.collection('users')
      .where('fincaId', '==', fincaId)
      .get();
    const targetUids = usersSnap.docs
      .filter(d => roles.includes(d.data().rol))
      .map(d => d.id);
    if (!targetUids.length) return;

    const VAPID_SUBJECT = 'mailto:aurora@finca.com';
    webpush.setVapidDetails(VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

    const payload = JSON.stringify({
      title: title || 'Aurora — Piloto Automático',
      body: body || '',
      icon: '/aurora-logo.png',
      badge: '/aurora-logo.png',
      data: { url: url || '/autopilot' },
    });

    for (const uid of targetUids) {
      const subSnap = await db.collection('push_subscriptions')
        .where('uid', '==', uid)
        .where('fincaId', '==', fincaId)
        .get();
      for (const subDoc of subSnap.docs) {
        try {
          await webpush.sendNotification(subDoc.data().subscription, payload);
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await subDoc.ref.delete();
          }
        }
      }
    }
  } catch (err) {
    console.error('[PUSH] Error sending push to roles:', err.message);
  }
}

// --- WHATSAPP NOTIFICATION HELPER ---
async function sendWhatsAppToFincaRoles(fincaId, roles, mensaje) {
  try {
    const usersSnap = await db.collection('users')
      .where('fincaId', '==', fincaId)
      .get();
    const targets = usersSnap.docs
      .filter(d => roles.includes(d.data().rol) && d.data().telefono)
      .map(d => d.data().telefono);
    if (!targets.length) return;

    const client = getTwilioClient();
    const from = `whatsapp:${twilioWhatsappFrom.value()}`;

    for (const phone of targets) {
      try {
        const to = `whatsapp:${phone.replace(/\s+/g, '')}`;
        await client.messages.create({ body: mensaje, from, to });
      } catch (err) {
        console.error(`[WHATSAPP] Error sending to ${phone}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[WHATSAPP] Error sending WhatsApp to roles:', err.message);
  }
}

// --- AUTOPILOT: execute approved action ---
async function executeAutopilotAction(type, params, fincaId, options = {}) {
  // Defense-in-depth kill switch: even if a future caller bypasses the route
  // middleware (cron jobs, internal callers), no Autopilot-driven side effect
  // runs while the finca is paused.
  if (await isAutopilotPaused(fincaId)) {
    throw new AutopilotPausedError(fincaId);
  }

  switch (type) {
    case 'crear_tarea': {
      const { nombre, loteId, responsableId, fecha, productos } = params;
      const prodList = Array.isArray(productos) ? productos : [];
      const newTask = {
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
      };
      const docRef = await db.collection('scheduled_tasks').add(newTask);
      return { ok: true, taskId: docRef.id, nombre };
    }

    case 'reprogramar_tarea': {
      const { taskId, newDate } = params;
      const ownership = await verifyOwnership('scheduled_tasks', taskId, fincaId);
      if (!ownership.ok) throw new Error(ownership.message);
      await db.collection('scheduled_tasks').doc(taskId).update({
        executeAt: Timestamp.fromDate(new Date(newDate + 'T08:00:00')),
      });
      return { ok: true, taskId, newDate };
    }

    case 'reasignar_tarea': {
      const { taskId, newUserId } = params;
      const ownership = await verifyOwnership('scheduled_tasks', taskId, fincaId);
      if (!ownership.ok) throw new Error(ownership.message);
      const taskData = ownership.doc.data();
      const updatedActivity = { ...taskData.activity, responsableId: newUserId };
      await db.collection('scheduled_tasks').doc(taskId).update({
        activity: updatedActivity,
        status: 'pending',
      });
      return { ok: true, taskId, newUserId };
    }

    case 'ajustar_inventario': {
      const { productoId, stockNuevo, nota } = params;
      const ownership = await verifyOwnership('productos', productoId, fincaId);
      if (!ownership.ok) throw new Error(ownership.message);
      const stockAnterior = ownership.doc.data().stockActual ?? 0;
      const batch = db.batch();
      batch.update(db.collection('productos').doc(productoId), { stockActual: stockNuevo });
      batch.set(db.collection('movimientos').doc(), {
        fincaId,
        productoId,
        tipo: 'ajuste_autopilot',
        cantidad: stockNuevo - stockAnterior,
        stockAnterior,
        stockNuevo,
        nota: nota || `Ajuste automático — Piloto Automático ${options.level || 'Nivel 2'}`,
        fecha: new Date(),
      });
      await batch.commit();
      return { ok: true, productoId, stockAnterior, stockNuevo };
    }

    case 'enviar_notificacion': {
      const { userId, mensaje, telefono } = params;
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
      return { ok: true, userId, enviado: true };
    }

    case 'crear_solicitud_compra': {
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
      const batch = db.batch();
      const solicitudRef = db.collection('solicitudes_compra').doc();
      const autopilotTag = `Piloto Automático ${options.level || ''}`.trim();
      batch.set(solicitudRef, {
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
      batch.set(taskRef, {
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
      await batch.commit();
      return { ok: true, solicitudId: solicitudRef.id, taskId: taskRef.id, itemsCount: mappedItems.length };
    }

    case 'crear_orden_compra': {
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
      const counterRef = db.collection('counters').doc(`oc_${fincaId}`);
      let seq;
      await db.runTransaction(async (t) => {
        const counterDoc = await t.get(counterRef);
        seq = (counterDoc.exists ? (counterDoc.data().value || 0) : 0) + 1;
        t.set(counterRef, { value: seq }, { merge: true });
      });
      const poNumber = `OC-${String(seq).padStart(6, '0')}`;
      const autopilotTag = `Piloto Automático ${options.level || ''}`.trim();
      const docRef = await db.collection('ordenes_compra').add({
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
      if (solicitudId) {
        try {
          const solTaskSnap = await db.collection('scheduled_tasks')
            .where('solicitudId', '==', solicitudId)
            .where('fincaId', '==', fincaId)
            .limit(1)
            .get();
          if (!solTaskSnap.empty) {
            await solTaskSnap.docs[0].ref.update({
              status: 'completed_by_user',
              completedAt: Timestamp.now(),
              ordenCompraId: docRef.id,
            });
          }
        } catch (_) { /* ignore */ }
      }
      return { ok: true, orderId: docRef.id, poNumber, itemsCount: items.length };
    }

    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

// --- AUTOPILOT: safety guardrails validation (Level 3) ---
function validateGuardrails(actionType, params, guardrails, sessionExecutedCount) {
  const violations = [];

  const maxActions = guardrails.maxActionsPerSession ?? 5;
  if (sessionExecutedCount >= maxActions) {
    violations.push(`Límite de ${maxActions} acciones autónomas por sesión alcanzado.`);
  }

  const allowed = guardrails.allowedActionTypes ??
    ['crear_tarea', 'reprogramar_tarea', 'reasignar_tarea', 'ajustar_inventario', 'enviar_notificacion', 'crear_solicitud_compra', 'crear_orden_compra'];
  if (!allowed.includes(actionType)) {
    violations.push(`Tipo de acción "${actionType}" no está habilitado para ejecución autónoma.`);
  }

  const blocked = guardrails.blockedLotes ?? [];
  const loteId = params.loteId || null;
  if (loteId && blocked.includes(loteId)) {
    violations.push(`El lote está bloqueado para acciones autónomas.`);
  }

  if (actionType === 'ajustar_inventario') {
    const maxPct = guardrails.maxStockAdjustPercent ?? 30;
    const current = params.stockActual ?? 0;
    const next = params.stockNuevo ?? 0;
    if (current > 0) {
      const pctChange = Math.abs(next - current) / current * 100;
      if (pctChange > maxPct) {
        violations.push(`Cambio de stock de ${pctChange.toFixed(0)}% excede el límite de ${maxPct}%.`);
      }
    }
  }

  return { allowed: violations.length === 0, violations };
}

// --- NOTIFICATION WITH LINK (WhatsApp message linking to the task) ---
const sendNotificationWithLink = async (taskRef, taskData, loteNombre) => {
  try {
    const client = getTwilioClient();

    const userDoc = await db.collection('users').doc(taskData.activity.responsableId).get();
    if (!userDoc.exists || !userDoc.data().telefono) return;

    const userData = userDoc.data();
    const cleanPhoneNumber = userData.telefono.replace(/\s+/g, '');
    const to = `whatsapp:${cleanPhoneNumber}`;
    const from = `whatsapp:${twilioWhatsappFrom.value()}`;

    let messageIntro;
    const activityDay = parseInt(taskData.activity.day);
    if (activityDay === 0) {
        messageIntro = `¡Nueva tarea para hoy!`;
    } else {
        const dateString = taskData.executeAt.toDate().toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long' });
        messageIntro = `¡Nueva tarea para el ${dateString}!`;
    }

    const taskUrl = `${APP_URL}/task/${taskRef.id}`;
    const body = `${messageIntro}\n*Actividad:* \"${taskData.activity.name}\"\n*Lote:* ${loteNombre}\n\n*Gestiona esta tarea aquí:*\n${taskUrl}`;

    await client.messages.create({ body, from, to });
    await taskRef.update({ status: 'notified' });
    console.log(`Notification with LINK sent for task ${taskRef.id} to ${cleanPhoneNumber}`);

  } catch (error) {
    console.error(`[ERROR] Failed to send notification with link for ${taskRef.id}:`, error);
  }
};

module.exports = {
  pick,
  verifyOwnership,
  ROLE_LEVELS_BE,
  hasMinRoleBE,
  enrichTask,
  writeFeedEvent,
  sendPushToFincaRoles,
  sendWhatsAppToFincaRoles,
  sendNotificationWithLink,
  executeAutopilotAction,
  validateGuardrails,
  AutopilotPausedError,
};
