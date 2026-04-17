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
const { getHealthSummary, getRecentFailures } = require('../lib/autopilotMetrics');

const router = Router();

const MAX_HEALTH_WINDOW_HOURS = 24 * 7;
const MAX_FAILURES_LIMIT = 50;

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

// GET /api/autopilot/health  (minRole: supervisor)
//   ?windowHours=24  (1..168, default 24)
//   ?failuresLimit=10 (1..50, default 10)
router.get('/api/autopilot/health', authenticate, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
  }
  try {
    const windowHours = clampInt(req.query.windowHours, 1, MAX_HEALTH_WINDOW_HOURS, 24);
    const failuresLimit = clampInt(req.query.failuresLimit, 1, MAX_FAILURES_LIMIT, 10);
    const [summary, recentFailures] = await Promise.all([
      getHealthSummary(req.fincaId, windowHours),
      getRecentFailures(req.fincaId, failuresLimit),
    ]);
    res.json({ summary, recentFailures });
  } catch (err) {
    console.error('[AUTOPILOT] Error fetching health:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch Autopilot health.', 500);
  }
});

function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

module.exports = router;
