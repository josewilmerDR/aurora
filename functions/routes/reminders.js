const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { rateLimit } = require('../lib/rateLimit');
const { getAnthropicClient } = require('../lib/clients');

const router = Router();

// --- API ENDPOINTS: PERSONAL REMINDERS ---

// GET /api/reminders/due — due reminders (remindAt <= now), marks them as delivered
router.get('/api/reminders/due', authenticate, async (req, res) => {
  try {
    const now = new Date();
    // No range filter in Firestore (would require composite index); filtered in JS
    const snap = await db.collection('reminders')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', req.fincaId)
      .where('status', '==', 'pending')
      .get();
    const dueDocs = snap.docs.filter(d => {
      const remindAt = d.data().remindAt?.toDate?.();
      return remindAt && remindAt <= now;
    });
    if (!dueDocs.length) return res.json([]);
    const batch = db.batch();
    const reminders = dueDocs.map(d => {
      batch.update(d.ref, { status: 'delivered' });
      return { id: d.id, message: d.data().message, remindAt: d.data().remindAt?.toDate?.()?.toISOString() };
    });
    await batch.commit();
    res.json(reminders);
  } catch (err) {
    console.error('Error fetching due reminders:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch due reminders.', 500);
  }
});

// GET /api/reminders — list all active reminders for the user. "Active" =
// pending (future) or delivered (past-due but not yet marked done/deleted by
// the user). Delivered reminders remain in this list so the user can see that
// the moment arrived and explicitly resolve them ("Hecho" or "Eliminar"); the
// push toast only fires the first time they go due.
router.get('/api/reminders', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('reminders')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', req.fincaId)
      .where('status', 'in', ['pending', 'delivered'])
      .get();
    const reminders = snap.docs
      .map(d => ({ id: d.id, message: d.data().message, remindAt: d.data().remindAt?.toDate?.()?.toISOString() }))
      .sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt));
    res.json(reminders);
  } catch (err) {
    console.error('Error fetching reminders:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch reminders.', 500);
  }
});

// POST /api/reminders — create a personal reminder
router.post('/api/reminders', authenticate, async (req, res) => {
  try {
    const { message, remindAt } = req.body;
    if (!message?.trim()) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Message is required.', 400);
    }
    if (!remindAt) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Reminder date is required.', 400);
    }
    const remindDate = new Date(remindAt);
    if (isNaN(remindDate.getTime())) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid date.', 400);
    }
    const docRef = await db.collection('reminders').add({
      uid: req.uid,
      fincaId: req.fincaId,
      message: message.trim(),
      remindAt: Timestamp.fromDate(remindDate),
      status: 'pending',
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: docRef.id, message: message.trim(), remindAt: remindDate.toISOString() });
  } catch (err) {
    console.error('Error creating reminder:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create reminder.', 500);
  }
});

// GET /api/reminders/done — list reminders the user has marked as done.
// Returned sorted by completion time (most recent first).
router.get('/api/reminders/done', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('reminders')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', req.fincaId)
      .where('status', '==', 'done')
      .get();
    const done = snap.docs
      .map(d => ({
        id: d.id,
        message: d.data().message,
        remindAt: d.data().remindAt?.toDate?.()?.toISOString(),
        completedAt: d.data().completedAt?.toDate?.()?.toISOString(),
      }))
      .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
    res.json(done);
  } catch (err) {
    console.error('Error fetching done reminders:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch done reminders.', 500);
  }
});

// POST /api/reminders/:id/done — mark a reminder as done (not deleted).
router.post('/api/reminders/:id/done', authenticate, async (req, res) => {
  try {
    const ref = db.collection('reminders').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Reminder not found.', 404);
    }
    if (doc.data().uid !== req.uid) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Access denied.', 403);
    }
    await ref.update({ status: 'done', completedAt: Timestamp.now() });
    res.json({
      id: doc.id,
      message: doc.data().message,
      remindAt: doc.data().remindAt?.toDate?.()?.toISOString(),
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error marking reminder done:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to mark reminder as done.', 500);
  }
});

// POST /api/reminders/parse — parse a natural-language prompt into a reminder
// and create it. Example input text: "recuérdame hoy a las 12:30 pm revisar la
// fruta del lote 4". Uses Claude Haiku with a tool schema for structured output.
router.post('/api/reminders/parse', authenticate, rateLimit('reminders_parse', 'ai_light'), async (req, res) => {
  try {
    const { text, clientTime, clientTzName, clientTzOffset } = req.body || {};
    if (!text?.trim()) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Text is required.', 400);
    }

    const userNow = clientTime ? new Date(clientTime) : new Date();
    const tz = clientTzName || 'America/Costa_Rica';
    const userDateTimeStr = userNow.toLocaleString('es-CR', {
      timeZone: tz,
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const anthropicClient = getAnthropicClient();
    const response = await anthropicClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      tool_choice: { type: 'tool', name: 'extraer_recordatorio' },
      tools: [{
        name: 'extraer_recordatorio',
        description: 'Extrae el mensaje y la fecha/hora de un recordatorio expresado en lenguaje natural.',
        input_schema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Qué debe recordarle al usuario, redactado como una nota clara en español. Ejemplo: "Revisar la fruta del lote 4".' },
            remindAt: { type: 'string', description: 'Fecha y hora en formato ISO 8601 SIN zona horaria (YYYY-MM-DDTHH:MM:00) interpretada en la zona horaria local del usuario. Si el usuario no especifica hora, usa T07:00:00.' },
          },
          required: ['message', 'remindAt'],
        },
      }],
      system: `Eres un extractor de recordatorios para la plataforma agrícola Aurora. Fecha y hora actual del usuario: ${userDateTimeStr} (${tz}). Interpretas frases como "recuérdame hoy a las 12:30 pm revisar la fruta del lote 4" o "en dos horas llamar al proveedor" y extraes mensaje + fecha/hora futura. Usa SIEMPRE la herramienta extraer_recordatorio; nunca respondas en texto libre.`,
      messages: [{ role: 'user', content: text.trim() }],
    });

    const toolUse = response.content.find(b => b.type === 'tool_use' && b.name === 'extraer_recordatorio');
    if (!toolUse) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'No se pudo interpretar el recordatorio. Intenta reformular.', 400);
    }
    const { message: rMsg, remindAt: rAt } = toolUse.input || {};
    if (!rMsg?.trim() || !rAt) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'No se pudo interpretar el recordatorio. Intenta reformular.', 400);
    }

    // Apply timezone offset when the model returns local time without tz suffix.
    const hasTz = /Z$|[+-]\d{2}:\d{2}$/.test(rAt);
    const remindDate = hasTz
      ? new Date(rAt)
      : new Date(new Date(rAt + 'Z').getTime() + (Number(clientTzOffset) || 0) * 60 * 1000);
    if (isNaN(remindDate.getTime())) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Fecha interpretada inválida.', 400);
    }
    if (remindDate.getTime() <= Date.now()) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'La fecha interpretada ya pasó. Sé más específico con el momento futuro.', 400);
    }

    const docRef = await db.collection('reminders').add({
      uid: req.uid,
      fincaId: req.fincaId,
      message: rMsg.trim(),
      remindAt: Timestamp.fromDate(remindDate),
      status: 'pending',
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: docRef.id, message: rMsg.trim(), remindAt: remindDate.toISOString() });
  } catch (err) {
    console.error('Error parsing reminder:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to parse reminder.', 500);
  }
});

// DELETE /api/reminders/:id — delete a reminder
router.delete('/api/reminders/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('reminders').doc(req.params.id).get();
    if (!doc.exists) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Reminder not found.', 404);
    }
    if (doc.data().uid !== req.uid) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Access denied.', 403);
    }
    await db.collection('reminders').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting reminder:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete reminder.', 500);
  }
});

module.exports = router;
