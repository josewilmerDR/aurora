// Handlers CRUD para `budgets`. Capa delgada: parse → validate → repository → respond.
// Toda la persistencia vive en repository.js.

const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { buildBudgetDoc } = require('./validator');
const repo = require('./repository');

// Campos de auditoría/persistencia que no salen al cliente. `createdByEmail`
// es PII y `createdBy`/`updatedBy` son uids internos: ningún consumidor de la
// lista los usa, así que los omitimos para no exponerlos en el bundle/red.
const INTERNAL_FIELDS = ['createdBy', 'createdByEmail', 'updatedBy'];

function stripInternal(doc) {
  const out = { ...doc };
  for (const f of INTERNAL_FIELDS) delete out[f];
  return out;
}

// Metadata común para los eventos de audit de un presupuesto.
function budgetAuditMeta(data) {
  return {
    period: data.period || null,
    category: data.category || null,
    assignedAmount: data.assignedAmount ?? null,
    currency: data.currency || null,
    loteId: data.loteId || null,
  };
}

// Si el presupuesto referencia un lote, verificamos que pertenezca a la finca
// (mismo patrón que income→resolveBuyer). Evita guardar un loteId de otra finca
// vía llamada directa a la API. Devuelve un mensaje de error o null.
async function validateLoteScope(loteId, fincaId) {
  if (!loteId) return null;
  const check = await verifyOwnership('lotes', loteId, fincaId);
  if (!check.ok) return 'loteId does not reference a lote in this finca.';
  return null;
}

async function listBudgets(req, res) {
  try {
    const data = await repo.listByFinca(req.fincaId, {
      period: req.query.period,
      category: req.query.category,
    });
    // Orden en memoria — evitamos exigir índices compuestos adicionales.
    data.sort((a, b) => (a.period || '').localeCompare(b.period || '')
      || (a.category || '').localeCompare(b.category || ''));
    res.json(data.map(stripInternal));
  } catch (error) {
    console.error('[BUDGETS] list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch budgets.', 500);
  }
}

async function createBudget(req, res) {
  try {
    const { error, data } = buildBudgetDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    const loteError = await validateLoteScope(data.loteId, req.fincaId);
    if (loteError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, loteError, 400);

    const id = await repo.create(req.fincaId, { uid: req.uid, userEmail: req.userEmail }, data);

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.BUDGET_CREATE,
      target: { type: 'budget', id },
      metadata: budgetAuditMeta(data),
      severity: SEVERITY.INFO,
    });

    res.status(201).json({ id, ...data });
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

    const loteError = await validateLoteScope(data.loteId, req.fincaId);
    if (loteError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, loteError, 400);

    await repo.update(req.params.id, { uid: req.uid }, data);

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.BUDGET_UPDATE,
      target: { type: 'budget', id: req.params.id },
      metadata: budgetAuditMeta(data),
      severity: SEVERITY.INFO,
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

    const prev = ownership.doc.data();
    await repo.remove(req.params.id);

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.BUDGET_DELETE,
      target: { type: 'budget', id: req.params.id },
      metadata: budgetAuditMeta(prev),
      severity: SEVERITY.WARNING,
    });

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
