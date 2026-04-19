// Handlers for `/api/financing/credit-products/...` — Fase 5.2.
//
// CRUD + filtering for credit products the finca is evaluating. Cost
// simulation lives in simulateCost.js; this file is pure CRUD.

const { db, FieldValue } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE, verifyOwnership } = require('../../lib/helpers');
const { buildCreditProductDoc } = require('../../lib/financing/creditProductValidator');

// ─── Filtering ────────────────────────────────────────────────────────────

// Applies the in-memory predicates that Firestore can't combine into a single
// range query. The catalog is small (dozens of products) so scanning is fine.
function matchesFilters(prod, query) {
  if (query.tipo && prod.tipo !== query.tipo) return false;
  if (query.providerType && prod.providerType !== query.providerType) return false;

  if (query.activo === 'true' && prod.activo !== true) return false;
  if (query.activo === 'false' && prod.activo !== false) return false;

  // Amount overlap: product accepts [monedaMin, monedaMax]; query window is
  // [queryMin, queryMax]. We keep the product if ranges overlap at all.
  const qAmountMin = Number(query.amountMin);
  const qAmountMax = Number(query.amountMax);
  if (Number.isFinite(qAmountMin) && prod.monedaMax < qAmountMin) return false;
  if (Number.isFinite(qAmountMax) && prod.monedaMin > qAmountMax) return false;

  const qPlazoMin = Number(query.plazoMin);
  const qPlazoMax = Number(query.plazoMax);
  if (Number.isFinite(qPlazoMin) && prod.plazoMesesMax < qPlazoMin) return false;
  if (Number.isFinite(qPlazoMax) && prod.plazoMesesMin > qPlazoMax) return false;

  return true;
}

// ─── List ─────────────────────────────────────────────────────────────────

async function listCreditProducts(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }

    const snap = await db.collection('credit_products')
      .where('fincaId', '==', req.fincaId)
      .get();

    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const filtered = all.filter(p => matchesFilters(p, req.query || {}));

    // Stable sort: providerName ASC, then tipo.
    filtered.sort((a, b) => {
      const byProv = (a.providerName || '').localeCompare(b.providerName || '');
      if (byProv !== 0) return byProv;
      return (a.tipo || '').localeCompare(b.tipo || '');
    });

    res.json(filtered);
  } catch (error) {
    console.error('[FINANCING] credit-products list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list credit products.', 500);
  }
}

// ─── Get one ──────────────────────────────────────────────────────────────

async function getCreditProduct(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }

    const ownership = await verifyOwnership('credit_products', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    res.json({ id: ownership.doc.id, ...ownership.doc.data() });
  } catch (error) {
    console.error('[FINANCING] credit-products get failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch credit product.', 500);
  }
}

// ─── Create ───────────────────────────────────────────────────────────────

async function createCreditProduct(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can manage catalog.', 403);
    }

    const { error, data } = buildCreditProductDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    const docRef = await db.collection('credit_products').add({
      ...data,
      fincaId: req.fincaId,
      createdBy: req.uid,
      createdByEmail: req.userEmail || '',
      createdAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: docRef.id, ...data });
  } catch (error) {
    console.error('[FINANCING] credit-products create failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create credit product.', 500);
  }
}

// ─── Update ───────────────────────────────────────────────────────────────

async function updateCreditProduct(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can manage catalog.', 403);
    }

    const ownership = await verifyOwnership('credit_products', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const { error, data } = buildCreditProductDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    await db.collection('credit_products').doc(req.params.id).update({
      ...data,
      updatedBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ id: req.params.id, ...data });
  } catch (error) {
    console.error('[FINANCING] credit-products update failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update credit product.', 500);
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────

async function deleteCreditProduct(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can manage catalog.', 403);
    }

    const ownership = await verifyOwnership('credit_products', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    await db.collection('credit_products').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (error) {
    console.error('[FINANCING] credit-products delete failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete credit product.', 500);
  }
}

module.exports = {
  listCreditProducts,
  getCreditProduct,
  createCreditProduct,
  updateCreditProduct,
  deleteCreditProduct,
  // exported for tests
  _internals: { matchesFilters },
};
