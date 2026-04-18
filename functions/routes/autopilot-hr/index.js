// Router for the HR autopilot agent (phase 3.4).
//
// Mirrors autopilot-procurement/index.js but with one crucial difference:
// actions under this router NEVER execute autonomously, regardless of
// the domain nivel. See `lib/hr/hrActionCaps.js` for the arch-level cap
// and `autopilot-hr/routeCandidate.js` for per-candidate enforcement.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { analyze } = require('./analyze');

const router = Router();

router.post('/api/autopilot/hr/analyze', authenticate, analyze);

module.exports = router;
