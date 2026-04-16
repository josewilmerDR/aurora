const { Router } = require('express');
const { db } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// --- API ENDPOINTS: FEED ---
router.get('/api/feed', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('feed')
      .where('fincaId', '==', req.fincaId)
      .orderBy('timestamp', 'desc')
      .limit(40)
      .get();
    const events = snapshot.docs.map(doc => {
      const data = doc.data();
      return { id: doc.id, ...data, timestamp: data.timestamp?.toMillis() ?? null };
    });
    res.json(events);
  } catch (error) {
    console.error('Error fetching feed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch feed.', 500);
  }
});

module.exports = router;
