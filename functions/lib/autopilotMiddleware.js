/**
 * Express middleware for Autopilot guards.
 *
 * Kept separate from the kill-switch domain module so the domain logic can be
 * reused outside HTTP contexts (cron jobs, internal callers) without dragging
 * Express request/response objects along.
 */

const { isPaused } = require('./autopilotKillSwitch');
const { sendApiError, ERROR_CODES } = require('./errors');

/**
 * Aborts the request with HTTP 423 (Locked) when the Autopilot is paused.
 * Must be placed after `authenticate` so `req.fincaId` is populated.
 *
 * Fail-safe: if the status check itself fails, the request is denied with 500
 * rather than allowed through. The kill switch is a safety mechanism — when in
 * doubt, deny.
 */
async function assertAutopilotActive(req, res, next) {
  try {
    if (await isPaused(req.fincaId)) {
      return sendApiError(
        res,
        ERROR_CODES.AUTOPILOT_PAUSED,
        'Autopilot is paused for this finca.',
        423,
      );
    }
    return next();
  } catch (err) {
    console.error('[AUTOPILOT] Killswitch check failed:', err);
    return sendApiError(
      res,
      ERROR_CODES.INTERNAL_ERROR,
      'Failed to verify Autopilot status.',
      500,
    );
  }
}

module.exports = { assertAutopilotActive };
