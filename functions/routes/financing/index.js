// Router for `/api/financing/...` — Fase 5 (External Financing).
//
// Fase 5.1 only exposes the financial profile endpoints. Later sub-fases
// (5.2 credit catalog, 5.3 eligibility, 5.4 debt simulations) will mount
// additional handlers under the same router.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const {
  getLiveProfile,
  createSnapshot,
  listSnapshots,
  getSnapshot,
  exportSnapshot,
} = require('./profile');

const router = Router();

// Order matters: specific paths before /:id.
router.get('/api/financing/profile/live', authenticate, getLiveProfile);

router.post('/api/financing/profile/snapshot', authenticate, createSnapshot);
router.get('/api/financing/profile/snapshots', authenticate, listSnapshots);
router.get('/api/financing/profile/snapshots/:id/export', authenticate, exportSnapshot);
router.get('/api/financing/profile/snapshots/:id', authenticate, getSnapshot);

module.exports = router;
