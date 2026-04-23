// Router para el agente financiero del autopilot.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { rateLimit } = require('../../lib/rateLimit');
const { analyze } = require('./analyze');

const router = Router();

router.post('/api/autopilot/finance/analyze', authenticate, rateLimit('autopilot_finance', 'ai_heavy'), analyze);

module.exports = router;
