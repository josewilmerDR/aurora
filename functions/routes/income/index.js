// Router para ingresos (income).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
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

router.get('/api/income', authenticate, requireRole('encargado'), listIncome);
router.post('/api/income', authenticate, requireRole('encargado'), createIncome);
router.put('/api/income/:id', authenticate, requireRole('encargado'), updateIncome);
router.delete('/api/income/:id', authenticate, requireRole('encargado'), deleteIncome);

module.exports = router;
