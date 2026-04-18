// Router for procurement analytics (phase 2.1+).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { getStockGaps } = require('./stockGaps');

const router = Router();

router.get('/api/procurement/stock-gaps', authenticate, getStockGaps);

module.exports = router;
