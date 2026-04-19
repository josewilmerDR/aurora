// Router for `/api/meta/...` — Fase 6 (Meta-agency / CEO emergente).
//
// Fase 6.0 mounts the FincaState snapshot endpoints — the unified view
// of the finca that the orchestrator (6.1) and downstream sweeps (6.2,
// 6.3) will consume. Later sub-fases add orchestrator, KPI, trust, and
// chain endpoints under the same router.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const {
  getLiveState,
  createSnapshot,
  listSnapshots,
  getSnapshot,
} = require('./fincaState');

const router = Router();

// Order matters: specific paths before /:id.
router.get('/api/meta/finca-state/live', authenticate, getLiveState);
router.post('/api/meta/finca-state/snapshot', authenticate, createSnapshot);
router.get('/api/meta/finca-state/snapshots', authenticate, listSnapshots);
router.get('/api/meta/finca-state/snapshots/:id', authenticate, getSnapshot);

module.exports = router;
