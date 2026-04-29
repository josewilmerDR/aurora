// Handlers CRUD para `budgets`. Capa delgada: parse → validate → repository → respond.
// Toda la persistencia vive en repository.js.

const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { buildBudgetDoc } = require('./validator');
const repo = require('./repository');

async function listBudgets(req, res) {
  try {
    const data = await repo.listByFinca(req.fincaId, {
      period: req.query.period,
      category: req.query.category,
    });
    // Orden en memoria — evitamos exigir índices compuestos adicionales.
    data.sort((a, b) => (a.period || '').localeCompare(b.period || '')
      || (a.category || '').localeCompare(b.category || ''));
    res.json(data);
  } catch (error) {
    console.error('[BUDGETS] list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch budgets.', 500);
  }
}

async function createBudget(req, res) {
  try {
    const { error, data } = buildBudgetDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    const id = await repo.create(req.fincaId, { uid: req.uid, userEmail: req.userEmail }, data);
    res.status(201).json({ id, ...data });
  } catch (error) {
    console.error('[BUDGETS] create failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create budget.', 500);
  }
}

async function updateBudget(req, res) {
  try {
    const ownership = await verifyOwnership('budgets', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const { error, data } = buildBudgetDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    await repo.update(req.params.id, { uid: req.uid }, data);
    res.json({ ok: true });
  } catch (error) {
    console.error('[BUDGETS] update failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update budget.', 500);
  }
}

async function deleteBudget(req, res) {
  try {
    const ownership = await verifyOwnership('budgets', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    await repo.remove(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error('[BUDGETS] delete failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete budget.', 500);
  }
}

module.exports = {
  listBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
};
