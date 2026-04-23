// Router for `/api/autopilot/orchestrator/...` — Fase 6.1 + 6.4.
//
// Meta-orchestrator endpoints. The orchestrator sits ABOVE the five
// specialist analyzers (finance / procurement / hr / strategy /
// financing) and decides which to call, in what order, and at what
// urgency. Fase 6.4 adds cross-domain chains for "CEO mode".

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { rateLimit } = require('../../lib/rateLimit');
const { analyze, listRuns, getRun } = require('./analyze');
const {
  planHandler,
  executeHandler,
  abortHandler,
  listHandler,
  detailHandler,
} = require('./chains');

const router = Router();

// Fase 6.1 — orchestrator runs.
router.post('/api/autopilot/orchestrator/analyze', authenticate, rateLimit('autopilot_orch_analyze', 'ai_heavy'), analyze);
router.get('/api/autopilot/orchestrator/runs', authenticate, listRuns);
router.get('/api/autopilot/orchestrator/runs/:id', authenticate, getRun);

// Fase 6.4 — cross-domain chains. Order: specific paths before /:id.
router.post('/api/autopilot/orchestrator/chains/plan', authenticate, rateLimit('autopilot_orch_plan', 'ai_heavy'), planHandler);
router.post('/api/autopilot/orchestrator/chains/:id/execute', authenticate, rateLimit('autopilot_orch_exec', 'ai_heavy'), executeHandler);
router.post('/api/autopilot/orchestrator/chains/:id/abort', authenticate, abortHandler);
router.get('/api/autopilot/orchestrator/chains', authenticate, listHandler);
router.get('/api/autopilot/orchestrator/chains/:id', authenticate, detailHandler);

module.exports = router;
