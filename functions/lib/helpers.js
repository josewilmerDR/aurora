const webpush = require('web-push');
const { db, Timestamp, FieldPath } = require('./firebase');
const { ERROR_CODES } = require('./errors');
const { signTaskLink } = require('./taskLinkToken');

// --- SECURITY HELPERS ---
const pick = (obj, fields) => fields.reduce((acc, f) => {
  if (obj[f] !== undefined) acc[f] = obj[f];
  return acc;
}, {});

// Always returns 404 when the caller can't see the doc (both "doesn't
// exist" and "belongs to another finca") to avoid cross-tenant enumeration
// via status-code observation.
//
// A structurally invalid id (empty, too long, or containing a path separator)
// is treated as "not found" rather than passed to db...doc(): the Admin SDK
// throws synchronously on such ids, which would otherwise surface as a generic
// 500. Folding it into the 404 keeps the response consistent (no enumeration
// signal) and spares each caller from repeating a docId guard.
const isValidDocId = (id) =>
  typeof id === 'string' && id.length > 0 && id.length <= 1500 && !id.includes('/');

const verifyOwnership = async (collection, docId, fincaId) => {
  if (!isValidDocId(docId)) {
    return { ok: false, status: 404, code: ERROR_CODES.NOT_FOUND, message: 'Document not found.' };
  }
  const doc = await db.collection(collection).doc(docId).get();
  if (!doc.exists || doc.data().fincaId !== fincaId) {
    return { ok: false, status: 404, code: ERROR_CODES.NOT_FOUND, message: 'Document not found.' };
  }
  return { ok: true, doc };
};

// --- ROLE HELPER ---
const ROLE_LEVELS_BE = { trabajador: 1, encargado: 2, supervisor: 3, rrhh: 3, administrador: 4 };
const hasMinRoleBE = (userRole, minRole) =>
  (ROLE_LEVELS_BE[userRole] || 0) >= (ROLE_LEVELS_BE[minRole] || 0);

// Resolve the `users` document id for a Firebase auth uid within a finca.
// Returns null if no matching user row exists (common for members whose
// `users` entry was never created or lives under a different fincaId).
// Callers use this to compare against `activity.responsableId`, which
// stores the users doc id (not the auth uid).
const getUserIdForUid = async (uid, fincaId) => {
  if (!uid || !fincaId) return null;
  const snap = await db.collection('users')
    .where('uid', '==', uid)
    .where('fincaId', '==', fincaId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
};

// --- TASK ENRICHMENT ---
const enrichTask = async (taskDoc, { lite = false } = {}) => {
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

  // Enriched/derived fields layered on top of the stored task.
  //
  // `lite` (used by the GET /api/tasks list) returns ONLY this whitelist — no
  // raw doc spread, no responsable phone — so the high-frequency list endpoint
  // does not ship internal fields (fincaId, snapshots, …) or PII to every
  // encargado+ on each load. The single-task deep-link, create, and
  // field-record paths use full mode because TaskAction needs the complete
  // `activity.productos` recipe and any other stored field.
  const enriched = {
    id: taskDoc.id,
    activityName: task.activity?.name,
    loteName: source
      ? (source.nombreLote || source.nombreGrupo || '—')
      : (task.snap_grupoNombre || task.snap_loteNombre || ((task.loteId || task.grupoId) ? 'Eliminado' : '—')),
    loteHectareas,
    responsableName: responsable
      ? responsable.nombre
      : (task.activity?.responsableNombre || 'Proveeduría'),
    dueDate: task.executeAt?.toDate?.()?.toISOString() ?? null,
    status: task.status,
    type: task.type,
    activity: task.activity ?? null,
    notas: task.notas ?? null,
  };

  if (lite) return enriched;
  // Full mode: stored doc first, enriched fields win on overlap. Note the
  // responsable phone is intentionally NOT included — it is unused by the
  // frontend and is PII.
  return { ...task, ...enriched };
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
      // Do NOT fall back to the raw email here: the feed is read by every
      // member of the finca (including trabajadores), so leaking emails would
      // expose PII for enumeration/phishing. Unresolved authors become
      // 'Sistema' via the guard below.
      userName = userSnap.empty ? null : userSnap.docs[0].data().nombre;
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

// Push a un usuario puntual (users doc id — mismo id que usa
// push_subscriptions.uid). Devuelve cuántas notificaciones se entregaron.
// Poda suscripciones muertas (410/404) igual que sendPushToFincaRoles.
// Nota: el canal WhatsApp (Twilio) se eliminó; push es el único canal de
// notificación saliente del backend.
async function sendPushToUser(fincaId, userId, { title, body, url }) {
  const subSnap = await db.collection('push_subscriptions')
    .where('uid', '==', userId)
    .where('fincaId', '==', fincaId)
    .get();
  if (subSnap.empty) return 0;

  const VAPID_SUBJECT = 'mailto:aurora@finca.com';
  webpush.setVapidDetails(VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({
    title: title || 'Aurora',
    body: body || '',
    icon: '/aurora-logo.png',
    badge: '/aurora-logo.png',
    data: { url: url || '/' },
  });

  let delivered = 0;
  for (const subDoc of subSnap.docs) {
    try {
      await webpush.sendNotification(subDoc.data().subscription, payload);
      delivered += 1;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await subDoc.ref.delete();
      }
    }
  }
  return delivered;
}

// NOTE: executeAutopilotAction and AutopilotPausedError live in
// ./autopilotActions.js. validateGuardrails lives in ./autopilotGuardrails.js.
// They were moved out of helpers.js as part of the hardening refactor —
// import them directly from those modules.

// Sanitize user-supplied strings before they are interpolated into a
// WhatsApp message body. WhatsApp renders a tiny Markdown-ish subset
// (*bold*, _italic_, ~strike~, `code`) and treats newlines literally,
// so an attacker-controlled `activity.name` could forge fake system
// alerts, inject links with bold emphasis, or break the message layout.
// We strip control chars, collapse whitespace, neuter the formatting
// characters, and cap length so one malicious task can't spam the
// recipient's screen. Returns a plain-text-safe string.
const escapeWhatsappText = (raw, maxLen = 120) => {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);
  // Control chars (incl. newlines, CR, tabs) → single space.
  s = s.replace(/[ -]+/g, ' ');
  // Collapse multiple spaces.
  s = s.replace(/\s{2,}/g, ' ').trim();
  // Neutralize WhatsApp formatting characters by inserting a zero-width
  // space — keeps visual content, breaks the parser's matching.
  s = s.replace(/([*_~`])/g, '$1​');
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + '…';
  return s;
};

// --- NOTIFICATION WITH LINK (push notification linking to the task) ---
// Antes salía por WhatsApp (Twilio); el canal se eliminó. El deep link
// /task/:id con token HMAC se conserva: viaja en data.url del push y el
// service worker abre la URL al tocar la notificación.
const sendNotificationWithLink = async (taskRef, taskData, loteNombre) => {
  try {
    const responsableId = taskData.activity?.responsableId;
    if (!responsableId || responsableId === 'proveeduria') return;

    let messageIntro;
    const activityDay = parseInt(taskData.activity.day);
    if (activityDay === 0) {
        messageIntro = `¡Nueva tarea para hoy!`;
    } else {
        const dateString = taskData.executeAt.toDate().toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long' });
        messageIntro = `¡Nueva tarea para el ${dateString}!`;
    }

    // Capability token — GET /api/tasks/:id verifies this before returning
    // the enriched payload (which contains PII). Null when the secret
    // isn't configured yet; the endpoint falls back to warn mode.
    const linkToken = signTaskLink(taskRef.id);
    const taskUrl = linkToken
      ? `/task/${taskRef.id}?t=${linkToken}`
      : `/task/${taskRef.id}`;
    // El saneo sigue aplicando: nombres controlados por usuarios no deben
    // poder inyectar saltos de línea ni formato en la notificación.
    const safeName = escapeWhatsappText(taskData.activity?.name, 100);
    const safeLote = escapeWhatsappText(loteNombre, 80);

    const delivered = await sendPushToUser(taskData.fincaId, responsableId, {
      title: messageIntro,
      body: `Actividad: "${safeName}" · Lote: ${safeLote}`,
      url: taskUrl,
    });
    // 'notified' solo si de verdad se entregó al menos una notificación —
    // antes el status cambiaba tras el POST a Twilio.
    if (delivered > 0) {
      await taskRef.update({ status: 'notified' });
      console.log(`Notification with LINK sent for task ${taskRef.id} (${delivered} push)`);
    }
  } catch (error) {
    console.error(`[ERROR] Failed to send notification with link for ${taskRef.id}:`, error);
  }
};

module.exports = {
  pick,
  verifyOwnership,
  ROLE_LEVELS_BE,
  hasMinRoleBE,
  getUserIdForUid,
  escapeWhatsappText,
  enrichTask,
  writeFeedEvent,
  sendPushToFincaRoles,
  sendPushToUser,
  sendNotificationWithLink,
};
