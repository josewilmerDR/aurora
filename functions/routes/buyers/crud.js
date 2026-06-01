// Handlers CRUD para `buyers`. Capa delgada: parse → validate → repository → respond.
// Toda la persistencia vive en repository.js.

const { verifyOwnership, hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { buildBuyerDoc, VALID_STATUSES } = require('./validator');
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
    // Buyers carry credit limit + payment terms; gate writes to encargado+
    // (the /finance/compradores page floor). listBuyers stays open for selectors.
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can create buyers.', 403);
    }
    const { error, data } = buildBuyerDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    // Upsert por taxId: re-subir la planilla de compradores actualiza en vez de
    // duplicar (mismo contrato que proveedores/machinery/productos). Sólo
    // deduplica cuando hay taxId; un comprador sin cédula/RUC siempre se crea.
    if (data.taxId) {
      const existingId = await repo.findIdByTaxId(req.fincaId, data.taxId);
      if (existingId) {
        await repo.update(existingId, data);
        return res.status(200).json({ id: existingId, merged: true });
      }
    }

    const id = await repo.create(req.fincaId, data);
    res.status(201).json({ id, merged: false });
  } catch (error) {
    console.error('[BUYERS] create failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create buyer.', 500);
  }
}

async function updateBuyer(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can update buyers.', 403);
    }
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

// PATCH parcial de estado (activo/inactivo). El toggle de la lista usa esta
// ruta en vez del PUT completo: así no reenvía todo el doc, evitando que el
// validador re-normalice campos accesorios (p. ej. creditDays caería a 30 si
// el doc almacenado lo tenía en null).
async function updateBuyerStatus(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can update buyers.', 403);
    }
    const ownership = await verifyOwnership('buyers', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const status = req.body?.status;
    if (!VALID_STATUSES.has(status)) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid status. Expected "activo" or "inactivo".', 400);
    }

    await repo.update(req.params.id, { status });
    res.json({ ok: true, status });
  } catch (error) {
    console.error('[BUYERS] status update failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update buyer status.', 500);
  }
}

async function deleteBuyer(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can delete buyers.', 403);
    }
    const ownership = await verifyOwnership('buyers', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    await repo.remove(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error('[BUYERS] delete failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete buyer.', 500);
  }
}

module.exports = { listBuyers, createBuyer, updateBuyer, updateBuyerStatus, deleteBuyer };
