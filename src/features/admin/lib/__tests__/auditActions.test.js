import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTION_OPTIONS, ACTION_LABEL } from '../auditActions';

// Guardrail contra el drift entre el catálogo ACTIONS del backend
// (functions/lib/auditLog.js) y las etiquetas de la UI (auditActions.js).
//
// No importamos el módulo del backend: arrastra firebase-admin y ejecuta
// admin.initializeApp al require. En su lugar leemos el archivo como texto y
// extraemos las acciones registradas (los string literals con punto dentro del
// bloque `const ACTIONS = Object.freeze({ … })`). Si el backend agrega una
// acción nueva y nadie le pone etiqueta acá, este test falla — en vez de que el
// admin termine viendo la clave cruda en la columna de acción y sin opción de
// filtro.

const here = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_LOG_PATH = path.resolve(here, '../../../../../functions/lib/auditLog.js');

function backendActionStrings() {
  const src = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
  const start = src.indexOf('const ACTIONS');
  const end = src.indexOf('const SEVERITY');
  expect(start, 'no se encontró el bloque ACTIONS en auditLog.js').toBeGreaterThanOrEqual(0);
  expect(end, 'no se encontró el bloque SEVERITY en auditLog.js').toBeGreaterThan(start);
  const block = src.slice(start, end);
  // Acciones = string literals dotted (al menos un punto), p.ej.
  // 'user.role.change', 'material_siembra.update', 'autopilot.guardrail.auto_apply'.
  const matches = [...block.matchAll(/'([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)'/g)];
  return [...new Set(matches.map(m => m[1]))];
}

describe('auditActions catalog', () => {
  test('extrae acciones del backend (sanity de la regex)', () => {
    const actions = backendActionStrings();
    // Si esto baja de ~40 algo se rompió en la extracción, no en el catálogo.
    expect(actions.length).toBeGreaterThan(40);
    expect(actions).toContain('user.role.change');
    expect(actions).toContain('cedula.apply');
    expect(actions).toContain('user.restrictedTo.change'); // camelCase en el medio
  });

  test('toda acción del backend tiene etiqueta en la UI', () => {
    const missing = backendActionStrings().filter(a => !(a in ACTION_LABEL));
    expect(
      missing,
      `Acciones de auditLog.js sin etiqueta en auditActions.js: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  test('no hay valores de acción duplicados en el dropdown', () => {
    const values = ACTION_OPTIONS.map(o => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
