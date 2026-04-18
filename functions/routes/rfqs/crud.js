// RFQ list / get / delete handlers. Creation and lifecycle endpoints live
// in their own files to keep this one focused on pure read/delete paths.

const { db } = require('../../lib/firebase');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

async function listRfqs(req, res) {
  try {
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
    let query = db.collection('rfqs')
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc')
      .limit(limit);
    if (req.query.estado) {
      query = db.collection('rfqs')
        .where('fincaId', '==', req.fincaId)
        .where('estado', '==', String(req.query.estado))
        .orderBy('createdAt', 'desc')
        .limit(limit);
    }
    const snap = await query.get();
    const rows = snap.docs.map(d => serialize(d));
    res.json(rows);
  } catch (error) {
    console.error('[RFQS] list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list RFQs.', 500);
  }
}

async function getRfq(req, res) {
  try {
    const ownership = await verifyOwnership('rfqs', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    res.json(serialize(ownership.doc));
  } catch (error) {
    console.error('[RFQS] get failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch RFQ.', 500);
  }
}

async function deleteRfq(req, res) {
  try {
    const ownership = await verifyOwnership('rfqs', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('rfqs').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (error) {
    console.error('[RFQS] delete failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete RFQ.', 500);
  }
}

function serialize(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
    closedAt: data.closedAt ? data.closedAt.toDate().toISOString() : null,
  };
}

module.exports = { listRfqs, getRfq, deleteRfq };
