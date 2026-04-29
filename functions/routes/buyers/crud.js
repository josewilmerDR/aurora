// Handlers CRUD para `buyers`. Capa delgada: parse → validate → repository → respond.
// Toda la persistencia vive en repository.js.

const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { buildBuyerDoc } = require('./validator');
const repo = require('./repository');

async function listBuyers(req, res) {
  try {
    const data = await repo.listByFinca(req.fincaId);
    res.json(data);
  } catch (error) {
    console.error('[BUYERS] list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch buyers.', 500);
  }
}

async function createBuyer(req, res) {
  try {
    const { error, data } = buildBuyerDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    const id = await repo.create(req.fincaId, data);
    res.status(201).json({ id });
  } catch (error) {
    console.error('[BUYERS] create failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create buyer.', 500);
  }
}

async function updateBuyer(req, res) {
  try {
    const ownership = await verifyOwnership('buyers', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const { error, data } = buildBuyerDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    await repo.update(req.params.id, data);
    res.json({ ok: true });
  } catch (error) {
    console.error('[BUYERS] update failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update buyer.', 500);
  }
}

async function deleteBuyer(req, res) {
  try {
    const ownership = await verifyOwnership('buyers', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    await repo.remove(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error('[BUYERS] delete failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete buyer.', 500);
  }
}

module.exports = { listBuyers, createBuyer, updateBuyer, deleteBuyer };
