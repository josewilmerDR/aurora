// Router para compradores (buyers).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { rateLimit } = require('../../lib/rateLimit');
const { listBuyers, createBuyer, updateBuyer, updateBuyerStatus, deleteBuyer } = require('./crud');

const router = Router();

// Role gate lives inside the handlers (crud.js); rateLimit must run as
// middleware so it can short-circuit before the handler executes.
// El GET hace un orderBy de colección completa por request; cap de abuso con un
// bucket propio para no compartir presupuesto con las escrituras.
router.get('/api/buyers', authenticate, rateLimit('buyers_read', 'write'), listBuyers);
router.post('/api/buyers', authenticate, rateLimit('buyers_write', 'write'), createBuyer);
router.put('/api/buyers/:id', authenticate, rateLimit('buyers_write', 'write'), updateBuyer);
router.patch('/api/buyers/:id/status', authenticate, rateLimit('buyers_write', 'write'), updateBuyerStatus);
router.delete('/api/buyers/:id', authenticate, rateLimit('buyers_write', 'write'), deleteBuyer);

module.exports = router;
