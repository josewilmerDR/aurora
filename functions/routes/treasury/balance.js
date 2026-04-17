// CRUD de `cash_balance` (serie histórica de saldos).

const { db, FieldValue } = require('../../lib/firebase');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { buildCashBalanceDoc } = require('./validator');

async function listBalances(req, res) {
  try {
    const snap = await db.collection('cash_balance')
      .where('fincaId', '==', req.fincaId)
      .get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    data.sort((a, b) => (b.dateAsOf || '').localeCompare(a.dateAsOf || ''));
    res.json(data);
  } catch (error) {
    console.error('[TREASURY] list balances failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch cash balances.', 500);
  }
}

async function getCurrentBalance(req, res) {
  try {
    const snap = await db.collection('cash_balance')
      .where('fincaId', '==', req.fincaId)
      .get();
    if (snap.empty) return res.json(null);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => (b.dateAsOf || '').localeCompare(a.dateAsOf || ''));
    res.json(docs[0]);
  } catch (error) {
    console.error('[TREASURY] current balance failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch current balance.', 500);
  }
}

async function createBalance(req, res) {
  try {
    const { error, data } = buildCashBalanceDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const doc = await db.collection('cash_balance').add({
      ...data,
      fincaId: req.fincaId,
      createdBy: req.uid,
      createdByEmail: req.userEmail || '',
      createdAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: doc.id, ...data });
  } catch (error) {
    console.error('[TREASURY] create balance failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create cash balance.', 500);
  }
}

async function deleteBalance(req, res) {
  try {
    const ownership = await verifyOwnership('cash_balance', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('cash_balance').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (error) {
    console.error('[TREASURY] delete balance failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete cash balance.', 500);
  }
}

module.exports = { listBalances, getCurrentBalance, createBalance, deleteBalance };
