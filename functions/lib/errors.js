/**
 * Standardized API error system.
 *
 * Backend throws/returns errors in English (for devs, logs, and future non-Spanish
 * contributors). Every response includes a machine-readable `code` that the frontend
 * maps to a Spanish message for end users via src/lib/errorMessages.js.
 *
 * Response shape: { code: "ERROR_CODE", message: "English dev message" }
 */

const ERROR_CODES = {
  // Auth / authorization
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_SESSION: 'INVALID_SESSION',
  FORBIDDEN: 'FORBIDDEN',
  NO_FINCA_ACCESS: 'NO_FINCA_ACCESS',
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',

  // Resource
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',

  // Input
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
  INVALID_INPUT: 'INVALID_INPUT',

  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',

  // Autopilot
  AUTOPILOT_PAUSED: 'AUTOPILOT_PAUSED',
};

class ApiError extends Error {
  constructor(code, devMessage, status = 400) {
    super(devMessage);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function sendApiError(res, code, devMessage, status = 400) {
  return res.status(status).json({ code, message: devMessage });
}

function handleApiError(res, err, fallbackMessage = 'Internal server error.') {
  if (err instanceof ApiError) {
    return sendApiError(res, err.code, err.message, err.status);
  }
  console.error('[API]', err);
  return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, fallbackMessage, 500);
}

module.exports = { ApiError, ERROR_CODES, sendApiError, handleApiError };
