// CRUD handlers para `budgets`.

const { db, FieldValue } = require('../../lib/firebase');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { buildBudgetDoc } = require('./validator');

async function listBudgets(req, res) {
  try {
    // Filtros opcionales por período y categoría.
    let q = db.collection('budgets').where('fincaId', '==', req.fincaId);
    const { period, category } = req.query;
    if (typeof period === 'string' && period) q = q.where('period', '==', period);
    if (typeof category === 'string' && category) q = q.where('category', '==', category);
    const snap = await q.get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
    const doc = await db.collection('budgets').add({
      ...data,
      fincaId: req.fincaId,
      createdBy: req.uid,
      createdByEmail: req.userEmail || '',
      createdAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: doc.id, ...data });
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

    await db.collection('budgets').doc(req.params.id).update({
      ...data,
      updatedBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
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
    await db.collection('budgets').doc(req.params.id).delete();
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
