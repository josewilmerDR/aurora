// Router para ROI (rentabilidad).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { getLive } = require('./live');

const router = Router();

router.get('/api/roi/live', authenticate, getLive);

module.exports = router;
