// Router for supplier analytics (procurement phase 2.0).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { getSupplierMetrics } = require('./metrics');
const { getSupplierRanking } = require('./ranking');

const router = Router();

router.get('/api/suppliers/ranking', authenticate, getSupplierRanking);
router.get('/api/suppliers/:id/metrics', authenticate, getSupplierMetrics);

module.exports = router;
