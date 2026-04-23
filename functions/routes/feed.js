const { Router } = require('express');
const { db } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { feedEventToModule, isModuleAllowed } = require('../lib/moduleClassifier');

const router = Router();

// --- API ENDPOINTS: FEED ---
router.get('/api/feed', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('feed')
      .where('fincaId', '==', req.fincaId)
      .orderBy('timestamp', 'desc')
      .limit(40)
      .get();
    let events = snapshot.docs.map(doc => {
      const data = doc.data();
      return { id: doc.id, ...data, timestamp: data.timestamp?.toMillis() ?? null };
    });

    // Module restriction: if the caller is pinned to specific modules, drop
    // feed events whose classified module is not in their allow-list. Events
    // with an unclassified eventType (feedEventToModule returns null) pass
    // through — they are typically generic notifications, not module-scoped.
    if (Array.isArray(req.userRestrictedTo) && req.userRestrictedTo.length > 0) {
      events = events.filter(e => {
        const mod = feedEventToModule(e.eventType, e.activityType);
        return isModuleAllowed(mod, req.userRestrictedTo);
      });
    }

    res.json(events);
  } catch (error) {
    console.error('Error fetching feed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch feed.', 500);
  }
});

module.exports = router;
