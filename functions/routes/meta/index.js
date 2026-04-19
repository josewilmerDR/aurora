// Router for `/api/meta/...` — Fase 6 (Meta-agency / CEO emergente).
//
// Fase 6.0 mounts the FincaState snapshot endpoints — the unified view
// of the finca that the orchestrator (6.1) and downstream sweeps (6.2,
// 6.3) will consume.
//
// Fase 6.2 adds KPI endpoints (observations aggregated into hit-rate
// per actionType × window, plus a manual sweep trigger for admins).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const {
  getLiveState,
  createSnapshot,
  listSnapshots,
  getSnapshot,
} = require('./fincaState');
const {
  getAccuracy,
  runSweep,
  listObservations,
} = require('./kpiAccuracy');
const {
  getScores,
  recompute,
  listProposals,
  approveProposal,
  rejectProposal,
  getCorridor,
} = require('./trust');

const router = Router();

// Fase 6.0 — FincaState snapshot endpoints. Order matters: specific
// paths before /:id.
router.get('/api/meta/finca-state/live', authenticate, getLiveState);
router.post('/api/meta/finca-state/snapshot', authenticate, createSnapshot);
router.get('/api/meta/finca-state/snapshots', authenticate, listSnapshots);
router.get('/api/meta/finca-state/snapshots/:id', authenticate, getSnapshot);

// Fase 6.2 — KPI accuracy + observations + manual sweep.
router.get('/api/meta/kpi-accuracy', authenticate, getAccuracy);
router.get('/api/meta/kpi-observations', authenticate, listObservations);
router.post('/api/meta/kpi-sweep/run', authenticate, runSweep);

// Fase 6.3 — trust scores + guardrail proposals (dynamic corridor).
router.get('/api/meta/trust/scores', authenticate, getScores);
router.get('/api/meta/trust/corridor', authenticate, getCorridor);
router.post('/api/meta/trust/recompute', authenticate, recompute);
router.get('/api/meta/guardrails/proposals', authenticate, listProposals);
router.post('/api/meta/guardrails/proposals/:id/approve', authenticate, approveProposal);
router.post('/api/meta/guardrails/proposals/:id/reject', authenticate, rejectProposal);

module.exports = router;
