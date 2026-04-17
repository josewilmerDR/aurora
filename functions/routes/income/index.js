// Router para ingresos (income). Montado desde `functions/index.js`.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const {
  listIncome,
  createIncome,
  updateIncome,
  deleteIncome,
} = require('./crud');
const { draftFromDispatch } = require('./dispatch-link');

const router = Router();

router.get('/api/income', authenticate, listIncome);
router.post('/api/income', authenticate, createIncome);
router.put('/api/income/:id', authenticate, updateIncome);
router.delete('/api/income/:id', authenticate, deleteIncome);

// Genera un borrador desde un despacho existente (no persiste).
router.get('/api/income/draft-from-dispatch/:despachoId', authenticate, draftFromDispatch);

module.exports = router;
