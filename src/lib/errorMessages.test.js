// Tests para el traductor de errores de API. Función pura — no toca DOM ni red.

import { describe, test, expect } from 'vitest';
import { translateApiError, ERROR_MESSAGES } from './errorMessages';

describe('translateApiError', () => {
  test('mapea un código conocido a la string en español', () => {
    expect(translateApiError({ code: 'UNAUTHORIZED' })).toBe(ERROR_MESSAGES.UNAUTHORIZED);
    expect(translateApiError({ code: 'VALIDATION_FAILED' })).toBe(ERROR_MESSAGES.VALIDATION_FAILED);
    expect(translateApiError({ code: 'AUTOPILOT_PAUSED' })).toBe(ERROR_MESSAGES.AUTOPILOT_PAUSED);
  });

  test('si no hay code conocido pero sí message, devuelve el message', () => {
    // Tolerancia para rutas legacy que devuelven mensajes en español como string suelta.
    expect(translateApiError({ message: 'Algo específico salió mal.' }))
      .toBe('Algo específico salió mal.');
  });

  test('si tampoco hay message pero sí campo error legacy, lo devuelve', () => {
    expect(translateApiError({ error: 'Mensaje legacy en error' }))
      .toBe('Mensaje legacy en error');
  });

  test('para body null/undefined usa el fallback', () => {
    expect(translateApiError(null)).toBe('Ocurrió un error inesperado.');
    expect(translateApiError(undefined)).toBe('Ocurrió un error inesperado.');
  });

  test('para code desconocido cae al fallback explícito', () => {
    expect(translateApiError({ code: 'PEPSI_OVERFLOW' }, 'mi fallback'))
      .toBe('mi fallback');
  });

  test('code conocido tiene prioridad sobre message', () => {
    expect(translateApiError({ code: 'NO_FINCA_ACCESS', message: 'Otro texto' }))
      .toBe(ERROR_MESSAGES.NO_FINCA_ACCESS);
  });

  test('cubre todos los códigos del backend documentados', () => {
    // Sentinela que detecta cuando se agrega un código en functions/lib/errors.js
    // y se olvida traducirlo aquí. Cualquier nuevo ERROR_CODES debería tener
    // entrada en ERROR_MESSAGES.
    const expectedCodes = [
      'UNAUTHORIZED', 'INVALID_SESSION', 'FORBIDDEN', 'NO_FINCA_ACCESS', 'INSUFFICIENT_ROLE',
      'NOT_FOUND', 'ALREADY_EXISTS', 'CONFLICT',
      'VALIDATION_FAILED', 'MISSING_REQUIRED_FIELDS', 'INVALID_INPUT',
      'INTERNAL_ERROR', 'EXTERNAL_SERVICE_ERROR', 'RATE_LIMITED',
      'AUTOPILOT_PAUSED',
    ];
    for (const code of expectedCodes) {
      expect(ERROR_MESSAGES[code]).toBeDefined();
      expect(typeof ERROR_MESSAGES[code]).toBe('string');
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });
});
