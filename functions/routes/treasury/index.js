// Router de tesorería (treasury).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { rateLimit } = require('../../lib/rateLimit');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const {
  listBalances,
  getCurrentBalance,
  createBalance,
  deleteBalance,
} = require('./balance');
const { getProjection } = require('./projection');

const router = Router();

// Tesorería expone saldos de caja y la proyección de liquidez de la finca —
// datos financieros sensibles. El sidebar gatea el módulo a encargado+, pero la
// UI es defensa secundaria: sin este chequeo un trabajador con token podría
// leer/escribir vía API directa. Middleware reutilizable (mismo patrón que
// budgets/costs).
function requireRole(min) {
  return (req, res, next) => {
    if (!hasMinRoleBE(req.userRole, min)) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, `${min} role required.`, 403);
    }
    next();
  };
}

// Saldos de caja (cash_balance).
router.get('/api/treasury/balance/current', authenticate, requireRole('encargado'), getCurrentBalance);
router.get('/api/treasury/balance', authenticate, requireRole('encargado'), listBalances);
router.post('/api/treasury/balance', authenticate, requireRole('encargado'), createBalance);
router.delete('/api/treasury/balance/:id', authenticate, requireRole('encargado'), deleteBalance);

// Proyección de caja — une 6 colecciones completas por request (income, OCs,
// proveedores, planilla fija/por unidad, saldo) → costly_read, igual que
// /api/roi/live.
router.get('/api/treasury/projection', authenticate, requireRole('encargado'), rateLimit('treasury_projection', 'costly_read'), getProjection);

module.exports = router;
