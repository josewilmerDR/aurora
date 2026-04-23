// Router for the procurement autopilot agent (phase 2.2).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { rateLimit } = require('../../lib/rateLimit');
const { analyze } = require('./analyze');

const router = Router();

router.post('/api/autopilot/procurement/analyze', authenticate, rateLimit('autopilot_procurement', 'ai_heavy'), analyze);

module.exports = router;
