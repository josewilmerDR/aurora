const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// --- API ENDPOINTS: WEB PUSH ---

// GET /api/push/vapid-public-key — returns the VAPID public key to the client
router.get('/api/push/vapid-public-key', authenticate, (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — save the user's push subscription
router.post('/api/push/subscribe', authenticate, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid subscription.', 400);
    }
    // Upsert: use the endpoint as the doc ID (base64-encoded to avoid invalid chars)
    const docId = Buffer.from(subscription.endpoint).toString('base64').slice(0, 500);
    await db.collection('push_subscriptions').doc(docId).set({
      uid: req.uid,
      fincaId: req.fincaId,
      subscription,
      updatedAt: Timestamp.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error saving push subscription:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save subscription.', 500);
  }
});

// DELETE /api/push/subscribe — remove the user's push subscription
router.delete('/api/push/subscribe', authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Endpoint is required.', 400);
    }
    const docId = Buffer.from(endpoint).toString('base64').slice(0, 500);
    await db.collection('push_subscriptions').doc(docId).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting push subscription:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete subscription.', 500);
  }
});

module.exports = router;
