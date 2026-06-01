// Router para ingresos (income).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const {
  listIncome,
  createIncome,
  updateIncome,
  deleteIncome,
} = require('./crud');

const router = Router();

// Los ingresos incluyen montos y datos de comprador (PII / relación comercial).
// El sidebar gatea la página a encargado+, pero la UI es defensa secundaria: sin
// este chequeo un trabajador con token podría leer/escribir vía API directa.
// Middleware reutilizable (mismo patrón que budgets/costs).
function requireRole(min) {
  return (req, res, next) => {
    if (!hasMinRoleBE(req.userRole, min)) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, `${min} role required.`, 403);
    }
    next();
  };
}

// rateLimit: el GET hace un orderBy de colección completa por request; los
// writes escriben sin tope. Buckets propios para no compartir presupuesto entre
// lecturas y escrituras (mismo patrón que buyers).
router.get('/api/income', authenticate, requireRole('encargado'), rateLimit('income_read', 'write'), listIncome);
router.post('/api/income', authenticate, requireRole('encargado'), rateLimit('income_write', 'write'), createIncome);
router.put('/api/income/:id', authenticate, requireRole('encargado'), rateLimit('income_write', 'write'), updateIncome);
router.delete('/api/income/:id', authenticate, requireRole('encargado'), rateLimit('income_write', 'write'), deleteIncome);

module.exports = router;
