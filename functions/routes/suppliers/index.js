// Router for supplier analytics (procurement phase 2.0).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { rateLimit } = require('../../lib/rateLimit');
const { getSupplierMetrics } = require('./metrics');
const { getSupplierRanking } = require('./ranking');

const router = Router();

router.get('/api/suppliers/ranking', authenticate, rateLimit('suppliers_read', 'costly_read'), getSupplierRanking);
router.get('/api/suppliers/:id/metrics', authenticate, rateLimit('suppliers_read', 'costly_read'), getSupplierMetrics);

module.exports = router;
