const { Router } = require('express');
const { db } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { feedEventToModule, isModuleAllowed } = require('../lib/moduleClassifier');
const { rateLimit } = require('../lib/rateLimit');

const router = Router();

// --- API ENDPOINTS: FEED ---
router.get('/api/feed', authenticate, rateLimit('feed_read', 'public_read'), async (req, res) => {
  try {
    const snapshot = await db.collection('feed')
      .where('fincaId', '==', req.fincaId)
      .orderBy('timestamp', 'desc')
      .limit(40)
      .get();
    // Whitelist the fields shipped to the client. Never spread the raw doc:
    // it carries the author's internal Firebase uid and the fincaId, which the
    // feed UI does not need and which would leak across the whole finca.
    let events = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        eventType: data.eventType,
        activityType: data.activityType ?? null,
        title: data.title ?? null,
        loteNombre: data.loteNombre ?? null,
        userName: data.userName ?? null,
        timestamp: data.timestamp?.toMillis() ?? null,
      };
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
