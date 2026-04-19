// Router for `/api/autopilot/orchestrator/...` — Fase 6.1.
//
// Meta-orchestrator endpoints. The orchestrator sits ABOVE the five
// specialist analyzers (finance / procurement / hr / strategy / financing)
// and decides which to call, in what order, and at what urgency.
// Subsequent sub-fases hang off this same router: 6.2 KPI sweep,
// 6.3 trust manager, 6.4 chain executor.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { analyze, listRuns, getRun } = require('./analyze');

const router = Router();

router.post('/api/autopilot/orchestrator/analyze', authenticate, analyze);
router.get('/api/autopilot/orchestrator/runs', authenticate, listRuns);
router.get('/api/autopilot/orchestrator/runs/:id', authenticate, getRun);

module.exports = router;
