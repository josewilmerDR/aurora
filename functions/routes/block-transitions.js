const { Router } = require('express');
const { db } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// GET /api/block-transitions
//   ?grupoId=X            — only transitions where X is origin or destination
//   &direction=origin|destination|both (default both, requires grupoId)
//   &limit=N              — max records (default 100, max 500)
//
// Records are sorted by `fecha` desc client-side after fetch so we can
// hit per-direction indexes without forcing an extra composite for the
// "both" case.
router.get('/api/block-transitions', authenticate, async (req, res) => {
  try {
    const { grupoId } = req.query;
    const direction = (req.query.direction || 'both').toLowerCase();
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100, 500);

    const queries = [];
    if (grupoId) {
      if (direction === 'origin' || direction === 'both') {
        queries.push(db.collection('block_transitions')
          .where('fincaId', '==', req.fincaId)
          .where('origenGrupoId', '==', grupoId)
          .orderBy('fecha', 'desc')
          .limit(limit));
      }
      if (direction === 'destination' || direction === 'both') {
        queries.push(db.collection('block_transitions')
          .where('fincaId', '==', req.fincaId)
          .where('destinoGrupoId', '==', grupoId)
          .orderBy('fecha', 'desc')
          .limit(limit));
      }
    } else {
      queries.push(db.collection('block_transitions')
        .where('fincaId', '==', req.fincaId)
        .orderBy('fecha', 'desc')
        .limit(limit));
    }

    const snaps = await Promise.all(queries.map(q => q.get()));
    const merged = new Map();
    for (const snap of snaps) {
      for (const doc of snap.docs) {
        const data = doc.data();
        merged.set(doc.id, {
          id: doc.id,
          ...data,
          fecha: data.fecha?.toDate?.()?.toISOString() ?? null,
        });
      }
    }
    const result = [...merged.values()]
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
      .slice(0, limit);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching block transitions:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch block transitions.', 500);
  }
});

module.exports = router;
