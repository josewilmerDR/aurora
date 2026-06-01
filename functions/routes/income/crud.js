// Handlers CRUD para `income_records`.

const { db, FieldValue } = require('../../lib/firebase');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { buildIncomeDoc, isValidISODate, VALID_COLLECTION_STATUSES } = require('./validator');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');

async function resolveBuyer(buyerId, fincaId) {
  if (!buyerId) return { error: 'Buyer is required.' };
  const doc = await db.collection('buyers').doc(buyerId).get();
  if (!doc.exists) return { error: 'Buyer not found.' };
  const data = doc.data();
  if (data.fincaId !== fincaId) return { error: 'Buyer belongs to another finca.' };
  return { name: data.name || '' };
}

// Integridad referencial: el loteId y los despachos ligados a un ingreso deben
// pertenecer a la misma finca. Sin esto, un miembro podría asociar un ingreso a
// un lote/despacho de otra finca (ensucia reportes y trazabilidad de cosecha).
// Recibe el doc ya validado (`data`) para reusar el saneamiento del validator.
async function verifyIncomeRefs(data, fincaId) {
  if (data.loteId) {
    const loteSnap = await db.collection('lotes').doc(data.loteId).get();
    if (!loteSnap.exists || loteSnap.data().fincaId !== fincaId) {
      return 'Lote not found or belongs to another finca.';
    }
  }
  if (Array.isArray(data.despachoIds) && data.despachoIds.length > 0) {
    const refs = data.despachoIds.map(d => db.collection('cosecha_despachos').doc(d.id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists || snap.data().fincaId !== fincaId) {
        return 'A dispatch was not found or belongs to another finca.';
      }
    }
  }
  return null;
}

async function listIncome(req, res) {
  try {
    let q = db.collection('income_records').where('fincaId', '==', req.fincaId);
    const { from, to, status } = req.query;
    // Whitelist de los filtros antes de pasarlos al where: formato ISO estricto
    // para fechas, set cerrado de estados. Evita armar queries con valores
    // arbitrarios controlados por el cliente.
    if (typeof from === 'string' && from) {
      if (!isValidISODate(from)) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid "from" date.', 400);
      q = q.where('date', '>=', from);
    }
    if (typeof to === 'string' && to) {
      if (!isValidISODate(to)) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid "to" date.', 400);
      q = q.where('date', '<=', to);
    }
    if (typeof status === 'string' && status) {
      if (!VALID_COLLECTION_STATUSES.has(status)) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid status filter.', 400);
      q = q.where('collectionStatus', '==', status);
    }
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

    const refError = await verifyIncomeRefs(data, req.fincaId);
    if (refError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, refError, 400);

    const doc = await db.collection('income_records').add({
      ...data,
      fincaId: req.fincaId,
      createdBy: req.uid,
      createdByEmail: req.userEmail || '',
      createdAt: FieldValue.serverTimestamp(),
    });

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.INCOME_CREATE,
      target: { type: 'income', id: doc.id },
      metadata: {
        buyerId: data.buyerId || null,
        buyerName: data.buyerName || null,
        amount: data.totalAmount ?? null,
        currency: data.currency || null,
        date: data.date || null,
      },
      severity: SEVERITY.INFO,
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

    const refError = await verifyIncomeRefs(data, req.fincaId);
    if (refError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, refError, 400);

    await db.collection('income_records').doc(req.params.id).update({
      ...data,
      updatedBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.INCOME_UPDATE,
      target: { type: 'income', id: req.params.id },
      metadata: {
        buyerId: data.buyerId || null,
        buyerName: data.buyerName || null,
        amount: data.totalAmount ?? null,
        currency: data.currency || null,
        date: data.date || null,
      },
      severity: SEVERITY.INFO,
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
    const prevData = ownership.doc.data();
    await db.collection('income_records').doc(req.params.id).delete();

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.INCOME_DELETE,
      target: { type: 'income', id: req.params.id },
      metadata: {
        buyerId: prevData.buyerId || null,
        buyerName: prevData.buyerName || null,
        amount: prevData.totalAmount ?? null,
        currency: prevData.currency || null,
        date: prevData.date || null,
      },
      severity: SEVERITY.WARNING,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('[INCOME] delete failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete income record.', 500);
  }
}

module.exports = { listIncome, createIncome, updateIncome, deleteIncome, resolveBuyer };
