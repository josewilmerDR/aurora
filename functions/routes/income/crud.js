// Handlers CRUD para `income_records`. Separados del router y del linker de
// despachos para no inflar el archivo.

const { db, FieldValue } = require('../../lib/firebase');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { buildIncomeDoc } = require('./validator');

// Resuelve el nombre del buyer y verifica que pertenece a la finca del request.
async function resolveBuyer(buyerId, fincaId) {
  if (!buyerId) return { error: 'Buyer is required.' };
  const doc = await db.collection('buyers').doc(buyerId).get();
  if (!doc.exists) return { error: 'Buyer not found.' };
  const data = doc.data();
  if (data.fincaId !== fincaId) return { error: 'Buyer belongs to another finca.' };
  return { name: data.name || '' };
}

async function listIncome(req, res) {
  try {
    // Filtros opcionales por rango de fecha y estado de cobro.
    let q = db.collection('income_records').where('fincaId', '==', req.fincaId);
    const { from, to, status } = req.query;
    if (typeof from === 'string' && from) q = q.where('date', '>=', from);
    if (typeof to === 'string' && to) q = q.where('date', '<=', to);
    if (typeof status === 'string' && status) q = q.where('collectionStatus', '==', status);
    const snapshot = await q.orderBy('date', 'desc').get();
    res.json(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    console.error('[INCOME] list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch income records.', 500);
  }
}

async function createIncome(req, res) {
  try {
    const buyer = await resolveBuyer(req.body.buyerId, req.fincaId);
    if (buyer.error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, buyer.error, 400);

    const { error, data } = buildIncomeDoc(req.body, { buyerName: buyer.name });
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    const doc = await db.collection('income_records').add({
      ...data,
      fincaId: req.fincaId,
      createdBy: req.uid,
      createdByEmail: req.userEmail || '',
      createdAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: doc.id, ...data });
  } catch (error) {
    console.error('[INCOME] create failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create income record.', 500);
  }
}

async function updateIncome(req, res) {
  try {
    const ownership = await verifyOwnership('income_records', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const buyer = await resolveBuyer(req.body.buyerId, req.fincaId);
    if (buyer.error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, buyer.error, 400);

    const { error, data } = buildIncomeDoc(req.body, { buyerName: buyer.name });
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    await db.collection('income_records').doc(req.params.id).update({
      ...data,
      updatedBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('[INCOME] update failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update income record.', 500);
  }
}

async function deleteIncome(req, res) {
  try {
    const ownership = await verifyOwnership('income_records', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('income_records').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (error) {
    console.error('[INCOME] delete failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete income record.', 500);
  }
}

module.exports = {
  listIncome,
  createIncome,
  updateIncome,
  deleteIncome,
  resolveBuyer,
};
