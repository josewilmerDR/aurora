// Router de tesorería (treasury).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const {
  listBalances,
  getCurrentBalance,
  createBalance,
  deleteBalance,
} = require('./balance');
const { getProjection } = require('./projection');

const router = Router();

// Saldos de caja (cash_balance).
router.get('/api/treasury/balance/current', authenticate, getCurrentBalance);
router.get('/api/treasury/balance', authenticate, listBalances);
router.post('/api/treasury/balance', authenticate, createBalance);
router.delete('/api/treasury/balance/:id', authenticate, deleteBalance);

// Proyección de caja.
router.get('/api/treasury/projection', authenticate, getProjection);

module.exports = router;
