// Router para compradores (buyers). Montado desde `functions/index.js`.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { listBuyers, createBuyer, updateBuyer, deleteBuyer } = require('./crud');

const router = Router();

router.get('/api/buyers', authenticate, listBuyers);
router.post('/api/buyers', authenticate, createBuyer);
router.put('/api/buyers/:id', authenticate, updateBuyer);
router.delete('/api/buyers/:id', authenticate, deleteBuyer);

module.exports = router;
