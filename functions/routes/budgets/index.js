// Router de presupuestos (budgets). Montado desde `functions/index.js`.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const {
  listBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
} = require('./crud');
const { getExecution } = require('./execution');

const router = Router();

// Orden importa: la ruta específica "/execution" debe ir antes de "/:id".
router.get('/api/budgets/execution', authenticate, getExecution);

router.get('/api/budgets', authenticate, listBudgets);
router.post('/api/budgets', authenticate, createBudget);
router.put('/api/budgets/:id', authenticate, updateBudget);
router.delete('/api/budgets/:id', authenticate, deleteBudget);

module.exports = router;
