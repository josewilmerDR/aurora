// Router for procurement analytics (phase 2.1+).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { rateLimit } = require('../../lib/rateLimit');
const { getStockGaps } = require('./stockGaps');

const router = Router();

router.get('/api/procurement/stock-gaps', authenticate, rateLimit('procurement_read', 'costly_read'), getStockGaps);

module.exports = router;
