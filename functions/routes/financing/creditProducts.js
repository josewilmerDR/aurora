// Handlers for `/api/financing/credit-products/...` — Fase 5.2.
//
// CRUD + filtering for credit products the finca is evaluating. Cost
// simulation lives in simulateCost.js; this file is pure CRUD.

const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE, verifyOwnership } = require('../../lib/helpers');
const { buildCreditProductDoc } = require('../../lib/financing/creditProductValidator');
const repo = require('./repository');

// ─── Filtering ────────────────────────────────────────────────────────────

// Aplica los predicates en memoria que Firestore no combina en una sola
// query de rangos. El catálogo es pequeño (decenas de productos por finca),
// así que escanear es aceptable.
function matchesFilters(prod, query) {
  if (query.tipo && prod.tipo !== query.tipo) return false;
  if (query.providerType && prod.providerType !== query.providerType) return false;

  if (query.activo === 'true' && prod.activo !== true) return false;
  if (query.activo === 'false' && prod.activo !== false) return false;

  // Amount overlap: el producto acepta [monedaMin, monedaMax]; la query es
  // [queryMin, queryMax]. Mantenemos el producto si los rangos se solapan.
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

    const all = await repo.listCreditProducts(req.fincaId);
    const filtered = all.filter((p) => matchesFilters(p, req.query || {}));

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

    const id = await repo.createCreditProduct(req.fincaId, {
      uid: req.uid,
      userEmail: req.userEmail,
    }, data);
    res.status(201).json({ id, ...data });
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

    await repo.updateCreditProduct(req.params.id, {
      uid: req.uid,
      userEmail: req.userEmail,
    }, data);
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

    await repo.removeCreditProduct(req.params.id);
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
