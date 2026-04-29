// Strategy — ciclo de decisión sobre recomendaciones.
//
// Sub-archivo del split de routes/strategy.js. Endpoints para listar
// recomendaciones, ver una, aceptarla (que ejecuta las siembras vía
// `executePropuestasAsSiembras`) o rechazarla. Permisos: supervisor+.
//
//   - GET  /api/strategy/rotation-recommendations
//   - GET  /api/strategy/rotation-recommendations/:id
//   - POST /api/strategy/rotation-recommendations/:id/accept   ejecuta siembras
//   - POST /api/strategy/rotation-recommendations/:id/reject   con razón opcional
//
// El campo `reasoning` se oculta para roles bajo supervisor (mismo patrón
// que el dominio autopilot).

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { isPaused: isAutopilotPaused } = require('../../lib/autopilotKillSwitch');
const {
  requireSupervisor,
  executePropuestasAsSiembras,
  stripReasoningForRole,
} = require('./helpers');

const router = Router();

router.get('/api/strategy/rotation-recommendations', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const snap = await db.collection('rotation_recommendations')
      .where('fincaId', '==', req.fincaId)
      .get();
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      })
      .map(item => stripReasoningForRole(item, req.userRole));
    res.status(200).json(items);
  } catch (error) {
    console.error('[strategy] list recommendations failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch recommendations.', 500);
  }
});

router.get('/api/strategy/rotation-recommendations/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('rotation_recommendations', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const data = ownership.doc.data();
    res.status(200).json({ id, ...stripReasoningForRole(data, req.userRole) });
  } catch (error) {
    console.error('[strategy] get recommendation failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch recommendation.', 500);
  }
});

router.post('/api/strategy/rotation-recommendations/:id/accept', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    if (await isAutopilotPaused(req.fincaId)) {
      return sendApiError(res, ERROR_CODES.AUTOPILOT_PAUSED, 'Autopilot is paused.', 423);
    }
    const { id } = req.params;
    const ownership = await verifyOwnership('rotation_recommendations', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const recDoc = ownership.doc.data();
    if (recDoc.status !== 'issued') {
      return sendApiError(
        res,
        ERROR_CODES.CONFLICT,
        `Recommendation is in status "${recDoc.status}" and cannot be accepted.`,
        409,
      );
    }
    if (!recDoc.guardrailsCheck?.allowed) {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        'Recommendation has blocking guardrail violations; it cannot be executed.',
        400,
      );
    }

    const executed = await executePropuestasAsSiembras({
      recommendationId: id,
      recDoc,
      fincaId: req.fincaId,
      actor: { uid: req.uid, email: req.userEmail },
      level: recDoc.level || 'nivel2',
    });
    const recRef = db.collection('rotation_recommendations').doc(id);
    await recRef.update({
      status: executed.allOk ? 'executed' : 'failed',
      executedSiembrasIds: executed.siembrasIds,
      executedActionsIds: executed.actionsIds,
      executionErrors: executed.errors,
      executedAt: Timestamp.now(),
      reviewedBy: req.uid,
      reviewedByEmail: req.userEmail || null,
      reviewedAt: Timestamp.now(),
    });
    const updated = (await recRef.get()).data();
    res.status(200).json({ id, ...stripReasoningForRole(updated, req.userRole) });
  } catch (error) {
    console.error('[strategy] accept failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to accept recommendation.', 500);
  }
});

router.post('/api/strategy/rotation-recommendations/:id/reject', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('rotation_recommendations', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const rec = ownership.doc.data();
    if (rec.status !== 'issued') {
      return sendApiError(
        res,
        ERROR_CODES.CONFLICT,
        `Recommendation is in status "${rec.status}" and cannot be rejected.`,
        409,
      );
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 512) : '';
    await db.collection('rotation_recommendations').doc(id).update({
      status: 'rejected',
      rejectionReason: reason || null,
      reviewedBy: req.uid,
      reviewedByEmail: req.userEmail || null,
      reviewedAt: Timestamp.now(),
    });
    res.status(200).json({ id, status: 'rejected', rejectionReason: reason });
  } catch (error) {
    console.error('[strategy] reject failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to reject recommendation.', 500);
  }
});

module.exports = router;
