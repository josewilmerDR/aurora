// Router de presupuestos (budgets). Montado desde `functions/index.js`.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const {
  listBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
} = require('./crud');
const { getExecution } = require('./execution');

const router = Router();

// Los presupuestos definen la configuración financiera de la finca y /execution
// expone costos consolidados (planilla, maquinaria, insumos). El sidebar gatea
// la página a encargado+, pero la UI es defensa secundaria: sin este chequeo un
// trabajador con token podría leer/escribir vía API directa. Middleware
// reutilizable para no repetir el chequeo en cada handler (patrón de costs.js).
function requireRole(min) {
  return (req, res, next) => {
    if (!hasMinRoleBE(req.userRole, min)) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, `${min} role required.`, 403);
    }
    next();
  };
}

// Orden importa: la ruta específica "/execution" debe ir antes de "/:id".
// rateLimit: computePeriodCosts lee 7 colecciones completas de la finca por
// request; el tier 'costly_read' (30/min) acota el martilleo desde el filtro de
// período más que 'write', acorde al costo de lectura.
router.get('/api/budgets/execution', authenticate, requireRole('encargado'), rateLimit('budgets_execution', 'costly_read'), getExecution);

router.get('/api/budgets', authenticate, requireRole('encargado'), listBudgets);
router.post('/api/budgets', authenticate, requireRole('encargado'), createBudget);
router.put('/api/budgets/:id', authenticate, requireRole('encargado'), updateBudget);
router.delete('/api/budgets/:id', authenticate, requireRole('encargado'), deleteBudget);

module.exports = router;
