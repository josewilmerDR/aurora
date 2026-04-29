// Autopilot — Feedback (👍/👎) y directives (reglas firmes del usuario).
//
// Sub-archivo del split de routes/autopilot.js. Cubre dos sub-features que
// alimentan el contexto de los prompts:
//   - copilot_feedback   → señales 👍/👎 sobre recomendaciones / acciones.
//                          Few-shot de estilo para el agente.
//   - copilot_directives → reglas firmes que el usuario activó manualmente.
//                          Inyectadas como <reglas_del_usuario> en el prompt.
//
// Ambos son por (userId, fincaId). Cada usuario gestiona los suyos; no hay
// agregación cross-user.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

const router = Router();

// ─── Feedback (👍/👎) ────────────────────────────────────────────────────

// POST /api/autopilot/feedback — save/update 👍/👎 on a recommendation or action
router.post('/api/autopilot/feedback', authenticate, async (req, res) => {
  try {
    const { sessionId, targetId, targetType, targetTitle, categoria, nivel, signal, comment } = req.body || {};
    if (!sessionId || !targetId || !['recommendation', 'action'].includes(targetType)) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Invalid params (sessionId, targetId, targetType).', 400);
    }
    if (!['up', 'down'].includes(signal)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'signal must be "up" or "down".', 400);
    }
    const docId = `${req.uid}_${sessionId}_${targetId}`;
    const now = Timestamp.now();
    await db.collection('copilot_feedback').doc(docId).set({
      userId: req.uid,
      userName: req.userEmail,
      fincaId: req.fincaId,
      nivel: nivel || null,
      sessionId,
      targetId,
      targetType,
      targetTitle: targetTitle ? String(targetTitle).slice(0, 200) : '',
      categoria: categoria || 'general',
      signal,
      comment: comment ? String(comment).slice(0, 500) : '',
      updatedAt: now,
      createdAt: now,
    }, { merge: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Error al guardar feedback:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save feedback.', 500);
  }
});

// DELETE /api/autopilot/feedback?sessionId=X&targetId=Y — clear feedback (toggle off)
router.delete('/api/autopilot/feedback', authenticate, async (req, res) => {
  try {
    const { sessionId, targetId } = req.query;
    if (!sessionId || !targetId) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Required params: sessionId, targetId.', 400);
    }
    const docId = `${req.uid}_${sessionId}_${targetId}`;
    await db.collection('copilot_feedback').doc(docId).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Error al borrar feedback:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete feedback.', 500);
  }
});

// GET /api/autopilot/feedback?sessionId=X — list current user's feedback (for UI pre-fill)
router.get('/api/autopilot/feedback', authenticate, async (req, res) => {
  try {
    const { sessionId } = req.query;
    let query = db.collection('copilot_feedback')
      .where('fincaId', '==', req.fincaId)
      .where('userId', '==', req.uid);
    if (sessionId) query = query.where('sessionId', '==', sessionId);
    const snap = await query.limit(100).get();
    const items = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        sessionId: d.sessionId,
        targetId: d.targetId,
        targetType: d.targetType,
        signal: d.signal,
        comment: d.comment || '',
        updatedAt: d.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });
    res.json(items);
  } catch (err) {
    console.error('[AUTOPILOT] Error al listar feedback:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list feedback.', 500);
  }
});

// ─── Directives (reglas firmes) ──────────────────────────────────────────

// GET /api/autopilot/directives — list active directives for current user
router.get('/api/autopilot/directives', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('copilot_directives')
      .where('fincaId', '==', req.fincaId)
      .where('userId', '==', req.uid)
      .where('active', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    const items = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        text: d.text,
        createdAt: d.createdAt?.toDate?.()?.toISOString() || null,
      };
    });
    res.json(items);
  } catch (err) {
    console.error('[AUTOPILOT] Error al listar directivas:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list directives.', 500);
  }
});

// POST /api/autopilot/directives — create a new explicit directive
router.post('/api/autopilot/directives', authenticate, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'text is required.', 400);
    if (text.length > 300) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'text must not exceed 300 characters.', 400);
    const now = Timestamp.now();
    const ref = await db.collection('copilot_directives').add({
      userId: req.uid,
      userName: req.userEmail,
      fincaId: req.fincaId,
      text,
      active: true,
      createdAt: now,
    });
    res.json({ id: ref.id, text, createdAt: now.toDate().toISOString() });
  } catch (err) {
    console.error('[AUTOPILOT] Error al crear directiva:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create directive.', 500);
  }
});

// DELETE /api/autopilot/directives/:id — soft delete
router.delete('/api/autopilot/directives/:id', authenticate, async (req, res) => {
  try {
    const ref = db.collection('copilot_directives').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Directive not found.', 404);
    const d = doc.data();
    if (d.fincaId !== req.fincaId || d.userId !== req.uid) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    await ref.update({ active: false });
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Error al eliminar directiva:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete directive.', 500);
  }
});

module.exports = router;
