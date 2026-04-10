const { Router } = require('express');
const { db } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');

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
    res.status(500).json({ message: 'Error al obtener el feed.' });
  }
});

module.exports = router;
