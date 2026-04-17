/**
 * Maps backend error codes to user-facing Spanish messages.
 *
 * Backend responses have shape { code, message }. The `code` is machine-readable
 * (English, stable identifier) and drives translation here. The `message` is the
 * English developer-facing description — used only as fallback if the code is
 * unknown or missing (e.g., during the transition while legacy routes still send
 * Spanish `message` strings directly).
 *
 * Add new codes to functions/lib/errors.js first, then add their Spanish text here.
 */

export const ERROR_MESSAGES = {
  // Auth / authorization
  UNAUTHORIZED: 'No autorizado.',
  INVALID_SESSION: 'Sesión inválida. Inicia sesión de nuevo.',
  FORBIDDEN: 'No tienes permiso para esta acción.',
  NO_FINCA_ACCESS: 'No tienes acceso a esta organización.',
  INSUFFICIENT_ROLE: 'No tienes el rol necesario para esta acción.',

  // Resource
  NOT_FOUND: 'Recurso no encontrado.',
  ALREADY_EXISTS: 'El recurso ya existe.',
  CONFLICT: 'Conflicto con el estado actual del recurso.',

  // Input
  VALIDATION_FAILED: 'Los datos enviados no son válidos.',
  MISSING_REQUIRED_FIELDS: 'Faltan campos obligatorios.',
  INVALID_INPUT: 'Entrada inválida.',

  // Server
  INTERNAL_ERROR: 'Error interno del servidor.',
  EXTERNAL_SERVICE_ERROR: 'Error en un servicio externo.',

  // Autopilot
  AUTOPILOT_PAUSED: 'El Piloto Automático está pausado. Reanúdalo para ejecutar acciones.',
};

const DEFAULT_FALLBACK = 'Ocurrió un error inesperado.';

/**
 * Translates a backend error response body to a user-facing Spanish message.
 * Accepts the parsed JSON body (or null/undefined).
 */
export function translateApiError(body, fallback = DEFAULT_FALLBACK) {
  if (!body) return fallback;
  if (body.code && ERROR_MESSAGES[body.code]) return ERROR_MESSAGES[body.code];
  if (typeof body.message === 'string' && body.message.length > 0) return body.message;
  if (typeof body.error === 'string' && body.error.length > 0) return body.error;
  return fallback;
}
