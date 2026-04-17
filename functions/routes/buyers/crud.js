// Handlers CRUD para `buyers`.

const { db, FieldValue } = require('../../lib/firebase');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { buildBuyerDoc } = require('./validator');

async function listBuyers(req, res) {
  try {
    const snapshot = await db.collection('buyers')
      .where('fincaId', '==', req.fincaId)
      .orderBy('name', 'asc')
      .get();
    const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
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
    const doc = await db.collection('buyers').add({
      ...data,
      fincaId: req.fincaId,
      createdAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: doc.id });
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
    await db.collection('buyers').doc(req.params.id).update(data);
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
    await db.collection('buyers').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (error) {
    console.error('[BUYERS] delete failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete buyer.', 500);
  }
}

module.exports = { listBuyers, createBuyer, updateBuyer, deleteBuyer };
