// Router para el agente financiero del autopilot.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { analyze } = require('./analyze');

const router = Router();

router.post('/api/autopilot/finance/analyze', authenticate, analyze);

module.exports = router;
