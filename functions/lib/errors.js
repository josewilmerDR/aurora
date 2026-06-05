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
  // Specialization of CONFLICT for delete blocked by inbound FK references.
  // Use when other docs still point at the target — the caller needs to
  // unhook those first.
  RESOURCE_REFERENCED: 'RESOURCE_REFERENCED',
  USER_HAS_HR_HISTORY: 'USER_HAS_HR_HISTORY',
  // codigoLote ya en uso dentro de la finca. Firestore no tiene unique
  // constraints, así que la unicidad se verifica en el handler de lotes
  // (POST / PUT). Código dedicado para que el frontend muestre un mensaje
  // específico ("ya existe un lote con ese código") en vez del genérico.
  LOTE_CODIGO_EXISTS: 'LOTE_CODIGO_EXISTS',
  // Borrado de grupo bloqueado por cédulas en estado terminal/intermedio.
  // CEDULA_APLICADA: hay cédulas ya aplicadas en campo (registro
  // fitosanitario, no se eliminan). CEDULA_EN_TRANSITO: hay cédulas en
  // "Mezcla lista" que deben resolverse (aplicar o anular) antes de borrar.
  // El frontend los mapea a mensajes en español (src/lib/errorMessages.js).
  CEDULA_APLICADA: 'CEDULA_APLICADA',
  CEDULA_EN_TRANSITO: 'CEDULA_EN_TRANSITO',
  // El usuario alcanzó el tope de organizaciones que puede crear (no es un
  // error de validación de input: el payload es válido, pero la cuota está
  // agotada → 409 Conflict).
  MAX_FINCAS_REACHED: 'MAX_FINCAS_REACHED',
  // Salida de bodega que excede el stock disponible del ítem. Se detecta dentro
  // de la transacción atómica (stock al momento del commit), no en validación
  // de input, así que es un conflicto de estado (409) y no un 400.
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',

  // Input
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
  INVALID_INPUT: 'INVALID_INPUT',

  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  // Autopilot
  AUTOPILOT_PAUSED: 'AUTOPILOT_PAUSED',
  COMPENSATION_NOT_AVAILABLE: 'COMPENSATION_NOT_AVAILABLE',
  COMPENSATION_NOT_COMPENSABLE: 'COMPENSATION_NOT_COMPENSABLE',
  COMPENSATION_EXPIRED: 'COMPENSATION_EXPIRED',
  COMPENSATION_ALREADY_APPLIED: 'COMPENSATION_ALREADY_APPLIED',
  COMPENSATION_BLOCKED: 'COMPENSATION_BLOCKED',
  ACTION_NOT_EXECUTED: 'ACTION_NOT_EXECUTED',
  ACTION_ALREADY_ROLLED_BACK: 'ACTION_ALREADY_ROLLED_BACK',
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
