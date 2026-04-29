// Autopilot — Sessions + actions (read endpoints + approve/reject).
//
// Sub-archivo del split de routes/autopilot.js. Cubre los endpoints de
// lectura (sessions list/detail, actions list/detail) y las transiciones
// de estado approve/reject que ejecuta o descarta una acción propuesta.
//
// /actions GET incluye reasoning sólo si el caller es supervisor+ (gateado
// en serializeAction). /approve es donde efectivamente se ejecuta una acción
// que estaba en status='proposed' — reusa executeAutopilotAction del lib.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE, writeFeedEvent } = require('../../lib/helpers');
const { executeAutopilotAction } = require('../../lib/autopilotActions');
const { assertAutopilotActive } = require('../../lib/autopilotMiddleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { serializeAction } = require('./helpers');

const router = Router();

// ─── Sessions ────────────────────────────────────────────────────────────

// GET /api/autopilot/sessions
router.get('/api/autopilot/sessions', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('autopilot_sessions')
      .where('fincaId', '==', req.fincaId)
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();
    const sessions = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        timestamp: d.timestamp?.toDate?.()?.toISOString() ?? null,
        triggeredByName: d.triggeredByName || '',
        snapshot: d.snapshot || {},
        recommendationsCount: (d.recommendations || []).length,
        status: d.status || 'completed',
      };
    });
    res.json(sessions);
  } catch (err) {
    console.error('[AUTOPILOT] Error al listar sesiones:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch sessions.', 500);
  }
});

// GET /api/autopilot/sessions/:id
router.get('/api/autopilot/sessions/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('autopilot_sessions').doc(req.params.id).get();
    if (!doc.exists) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Session not found.', 404);
    const d = doc.data();
    if (d.fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    res.json({
      id: doc.id,
      timestamp: d.timestamp?.toDate?.()?.toISOString() ?? null,
      triggeredByName: d.triggeredByName || '',
      snapshot: d.snapshot || {},
      recommendations: d.recommendations || [],
      status: d.status || 'completed',
      errorMessage: d.errorMessage || null,
    });
  } catch (err) {
    console.error('[AUTOPILOT] Failed to fetch session:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch session.', 500);
  }
});

// ─── Actions ─────────────────────────────────────────────────────────────

// GET /api/autopilot/actions — lista acciones propuestas/ejecutadas
//   ?status=...        filter
//   ?sessionId=...     filter
//   ?includeReasoning=1 (supervisor+ only) — returns the captured Claude reasoning
router.get('/api/autopilot/actions', authenticate, async (req, res) => {
  try {
    const wantsReasoning = req.query.includeReasoning === '1';
    const includeReasoning = wantsReasoning && hasMinRoleBE(req.userRole, 'supervisor');
    const snap = await db.collection('autopilot_actions')
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    let actions = snap.docs.map(doc => serializeAction(doc, { includeReasoning }));
    const { status, sessionId, categoria } = req.query;
    if (status) actions = actions.filter(a => a.status === status);
    if (sessionId) actions = actions.filter(a => a.sessionId === sessionId);
    if (categoria) actions = actions.filter(a => a.categoria === categoria);
    res.json(actions);
  } catch (err) {
    console.error('[AUTOPILOT] Error al listar acciones:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch actions.', 500);
  }
});

// GET /api/autopilot/actions/:id — single action; supervisor+ gets reasoning included
router.get('/api/autopilot/actions/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('autopilot_actions').doc(req.params.id).get();
    if (!doc.exists) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Action not found.', 404);
    if (doc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    const includeReasoning = hasMinRoleBE(req.userRole, 'supervisor');
    res.json(serializeAction(doc, { includeReasoning }));
  } catch (err) {
    console.error('[AUTOPILOT] Failed to fetch action:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch action.', 500);
  }
});

// PUT /api/autopilot/actions/:id/approve — approves and executes an action (supervisor+)
router.put('/api/autopilot/actions/:id/approve', authenticate, assertAutopilotActive, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
  }
  try {
    const docRef = db.collection('autopilot_actions').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Action not found.', 404);
    const action = doc.data();
    if (action.fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    if (action.status !== 'proposed') {
      return sendApiError(res, ERROR_CODES.CONFLICT, `Action already processed (${action.status}).`, 400);
    }

    await docRef.update({
      status: 'approved',
      reviewedBy: req.uid,
      reviewedByName: req.userEmail,
      reviewedAt: Timestamp.now(),
    });

    let executionResult;
    try {
      // Pass actionDocRef so the executor writes status='executed' (or 'failed')
      // atomically with the side effect, and records latencyMs itself.
      executionResult = await executeAutopilotAction(action.type, action.params, req.fincaId, {
        actionDocRef: docRef,
      });
    } catch (execErr) {
      console.error('[AUTOPILOT] Error al ejecutar acción:', execErr);
      // Action doc was already updated to status='failed' by the executor.
      return res.json({ ok: true, status: 'failed', error: execErr.message });
    }

    writeFeedEvent({
      fincaId: req.fincaId, uid: req.uid, userEmail: req.userEmail,
      eventType: 'autopilot_action_executed',
      title: `Acción aprobada y ejecutada: ${action.titulo}`,
    });

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.AUTOPILOT_ACTION_APPROVE,
      target: { type: 'autopilot_action', id: req.params.id },
      metadata: {
        tipo: action.type || null,
        titulo: (action.titulo || '').slice(0, 200),
        categoria: action.categoria || null,
        prioridad: action.prioridad || null,
      },
      severity: SEVERITY.WARNING,
    });

    res.json({ ok: true, status: 'executed', executionResult });
  } catch (err) {
    console.error('[AUTOPILOT] Failed to approve action:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to approve action.', 500);
  }
});

// PUT /api/autopilot/actions/:id/reject — rejects a proposed action (supervisor+)
router.put('/api/autopilot/actions/:id/reject', authenticate, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
  }
  try {
    const docRef = db.collection('autopilot_actions').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Action not found.', 404);
    const action = doc.data();
    if (action.fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    if (action.status !== 'proposed') {
      return sendApiError(res, ERROR_CODES.CONFLICT, `Action already processed (${action.status}).`, 400);
    }

    const { reason } = req.body || {};
    await docRef.update({
      status: 'rejected',
      reviewedBy: req.uid,
      reviewedByName: req.userEmail,
      reviewedAt: Timestamp.now(),
      rejectionReason: reason || null,
    });

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.AUTOPILOT_ACTION_REJECT,
      target: { type: 'autopilot_action', id: req.params.id },
      metadata: {
        tipo: action.type || null,
        titulo: (action.titulo || '').slice(0, 200),
        reason: reason ? String(reason).slice(0, 500) : null,
      },
      severity: SEVERITY.INFO,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Failed to reject action:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to reject action.', 500);
  }
});

module.exports = router;
