const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

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

// GET /api/reminders — list all pending reminders for the user
router.get('/api/reminders', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('reminders')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', req.fincaId)
      .where('status', '==', 'pending')
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
