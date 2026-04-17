/**
 * Autopilot control endpoints — separated from `autopilot.js` to keep the
 * monolithic AI/agency router from growing further. Owns the kill switch
 * (pause / resume) and the lightweight status read used by the UI banner.
 */

const { Router } = require('express');
const { authenticate } = require('../lib/middleware');
const { hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { getStatus, pause, resume } = require('../lib/autopilotKillSwitch');

const router = Router();

// GET /api/autopilot/status — read-only, available to any authenticated member.
router.get('/api/autopilot/status', authenticate, async (req, res) => {
  try {
    const status = await getStatus(req.fincaId);
    res.json(status);
  } catch (err) {
    console.error('[AUTOPILOT] Error fetching status:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch Autopilot status.', 500);
  }
});

// POST /api/autopilot/pause  (minRole: administrador)
router.post('/api/autopilot/pause', authenticate, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'administrador')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Administrador role required.', 403);
  }
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    const result = await pause(req.fincaId, {
      uid: req.uid,
      userEmail: req.userEmail,
      reason,
    });
    if (result.alreadyPaused) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Autopilot is already paused.', 409);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Error pausing:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to pause Autopilot.', 500);
  }
});

// POST /api/autopilot/resume  (minRole: administrador)
router.post('/api/autopilot/resume', authenticate, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'administrador')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Administrador role required.', 403);
  }
  try {
    const result = await resume(req.fincaId, {
      uid: req.uid,
      userEmail: req.userEmail,
    });
    if (result.notPaused) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Autopilot is not paused.', 409);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Error resuming:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to resume Autopilot.', 500);
  }
});

module.exports = router;
