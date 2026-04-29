// Strategy — CRUD de constraints agronómicos (`rotation_constraints`).
//
// Sub-archivo del split de routes/strategy.js. Catálogo editable de
// restricciones por cultivo (descanso mínimo entre ciclos, familias
// botánicas incompatibles, etc.) que el recomendador respeta. Permisos:
// supervisor+.
//
// Endpoints:
//   - GET    /api/strategy/rotation-constraints
//   - POST   /api/strategy/rotation-constraints      (cultivo único por finca)
//   - PUT    /api/strategy/rotation-constraints/:id  (partial update)
//   - DELETE /api/strategy/rotation-constraints/:id

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { pick, verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const {
  validateConstraintPayload,
  normalizeConstraintPayload,
} = require('../../lib/strategy/rotationConstraintsValidator');
const { requireSupervisor } = require('./helpers');

const router = Router();

router.get('/api/strategy/rotation-constraints', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const snap = await db.collection('rotation_constraints')
      .where('fincaId', '==', req.fincaId)
      .get();
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.cultivo || '').localeCompare(b.cultivo || ''));
    res.status(200).json(items);
  } catch (error) {
    console.error('[strategy] list constraints failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch rotation constraints.', 500);
  }
});

router.post('/api/strategy/rotation-constraints', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const allowed = ['cultivo', 'familiaBotanica', 'descansoMinCiclos', 'descansoMinDias', 'incompatibleCon', 'notas'];
    const raw = pick(req.body, allowed);
    const validationError = validateConstraintPayload(raw);
    if (validationError) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    }
    const payload = normalizeConstraintPayload(raw);
    // Unicidad lógica: no permitimos dos constraints activos con el mismo
    // `cultivo` (case-insensitive) en la misma finca.
    const existingSnap = await db.collection('rotation_constraints')
      .where('fincaId', '==', req.fincaId)
      .get();
    const conflict = existingSnap.docs
      .map(d => d.data())
      .find(c => (c.cultivo || '').toLowerCase() === payload.cultivo.toLowerCase());
    if (conflict) {
      return sendApiError(
        res,
        ERROR_CODES.CONFLICT,
        `A constraint for cultivo "${payload.cultivo}" already exists.`,
        409,
      );
    }
    const toStore = {
      ...payload,
      fincaId: req.fincaId,
      createdBy: req.uid,
      createdByEmail: req.userEmail || null,
      createdAt: Timestamp.now(),
    };
    const ref = await db.collection('rotation_constraints').add(toStore);
    res.status(201).json({ id: ref.id, ...toStore });
  } catch (error) {
    console.error('[strategy] create constraint failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create constraint.', 500);
  }
});

router.put('/api/strategy/rotation-constraints/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('rotation_constraints', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const allowed = ['cultivo', 'familiaBotanica', 'descansoMinCiclos', 'descansoMinDias', 'incompatibleCon', 'notas'];
    const raw = pick(req.body, allowed);
    const validationError = validateConstraintPayload(raw, { partial: true });
    if (validationError) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    }
    const payload = normalizeConstraintPayload(raw);
    const toUpdate = {
      ...payload,
      updatedBy: req.uid,
      updatedAt: Timestamp.now(),
    };
    await db.collection('rotation_constraints').doc(id).update(toUpdate);
    res.status(200).json({ id, ...toUpdate });
  } catch (error) {
    console.error('[strategy] update constraint failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update constraint.', 500);
  }
});

router.delete('/api/strategy/rotation-constraints/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('rotation_constraints', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    await db.collection('rotation_constraints').doc(id).delete();
    res.status(200).json({ id, deleted: true });
  } catch (error) {
    console.error('[strategy] delete constraint failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete constraint.', 500);
  }
});

module.exports = router;
