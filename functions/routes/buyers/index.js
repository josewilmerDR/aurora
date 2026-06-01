// Router para compradores (buyers).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { listBuyers, createBuyer, updateBuyer, updateBuyerStatus, deleteBuyer } = require('./crud');

const router = Router();

// Gate de rol AUTORITATIVO a nivel de router (encargado+), consistente con el
// resto del dominio finance (budgets/income/treasury/costs). Antes vivía sólo
// dentro de cada handler de crud.js; centralizarlo garantiza el piso de rol aun
// si se monta un handler nuevo sin su chequeo. Los handlers conservan el suyo
// como defensa en profundidad. rateLimit corre después para que pueda
// cortocircuitar antes del handler.
function requireRole(min) {
  return (req, res, next) => {
    if (!hasMinRoleBE(req.userRole, min)) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, `${min} role required.`, 403);
    }
    next();
  };
}

router.get('/api/buyers', authenticate, requireRole('encargado'), rateLimit('buyers_read', 'write'), listBuyers);
router.post('/api/buyers', authenticate, requireRole('encargado'), rateLimit('buyers_write', 'write'), createBuyer);
router.put('/api/buyers/:id', authenticate, requireRole('encargado'), rateLimit('buyers_write', 'write'), updateBuyer);
router.patch('/api/buyers/:id/status', authenticate, requireRole('encargado'), rateLimit('buyers_write', 'write'), updateBuyerStatus);
router.delete('/api/buyers/:id', authenticate, requireRole('encargado'), rateLimit('buyers_write', 'write'), deleteBuyer);

module.exports = router;
