// Router para ingresos (income).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const {
  listIncome,
  createIncome,
  updateIncome,
  deleteIncome,
} = require('./crud');

const router = Router();

router.get('/api/income', authenticate, listIncome);
router.post('/api/income', authenticate, createIncome);
router.put('/api/income/:id', authenticate, updateIncome);
router.delete('/api/income/:id', authenticate, deleteIncome);

module.exports = router;
