const webpush = require('web-push');
const { db, Timestamp, FieldPath, APP_URL, twilioWhatsappFrom } = require('./firebase');
const { getTwilioClient } = require('./clients');
const { ERROR_CODES } = require('./errors');

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

// NOTE: executeAutopilotAction and AutopilotPausedError live in
// ./autopilotActions.js. validateGuardrails lives in ./autopilotGuardrails.js.
// They were moved out of helpers.js as part of the hardening refactor —
// import them directly from those modules.

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
};
