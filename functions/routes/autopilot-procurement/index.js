// Router for the procurement autopilot agent (phase 2.2).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { analyze } = require('./analyze');

const router = Router();

router.post('/api/autopilot/procurement/analyze', authenticate, analyze);

module.exports = router;
