// Smoke tests para los helpers puros de UserContext.
// El componente UserProvider hace network/Firebase y se prueba a través de
// los componentes que lo consumen — aquí sólo cubrimos hasMinRole / ROLE_LEVELS.

import { describe, test, expect } from 'vitest';
import { hasMinRole, ROLE_LEVELS, ROLE_LABELS } from './UserContext';

describe('hasMinRole', () => {
  test('un trabajador NO cumple con encargado/supervisor/admin', () => {
    expect(hasMinRole('trabajador', 'trabajador')).toBe(true);
    expect(hasMinRole('trabajador', 'encargado')).toBe(false);
    expect(hasMinRole('trabajador', 'supervisor')).toBe(false);
    expect(hasMinRole('trabajador', 'administrador')).toBe(false);
  });

  test('administrador cumple cualquier rol mínimo', () => {
    expect(hasMinRole('administrador', 'trabajador')).toBe(true);
    expect(hasMinRole('administrador', 'encargado')).toBe(true);
    expect(hasMinRole('administrador', 'supervisor')).toBe(true);
    expect(hasMinRole('administrador', 'administrador')).toBe(true);
  });

  test('rrhh y supervisor están al mismo nivel (3)', () => {
    expect(hasMinRole('rrhh', 'supervisor')).toBe(true);
    expect(hasMinRole('supervisor', 'rrhh')).toBe(true);
  });

  test('roles desconocidos reciben level 0 y nunca cumplen', () => {
    expect(hasMinRole('intruso', 'trabajador')).toBe(false);
    expect(hasMinRole(undefined, 'trabajador')).toBe(false);
    expect(hasMinRole(null, 'encargado')).toBe(false);
  });

  test('comparar contra un minRole desconocido cuenta como nivel 0 (siempre cumple)', () => {
    // Edge case: si pasamos un minRole inexistente, ROLE_LEVELS[minRole] = 0
    // y cualquier rol con nivel ≥ 0 cumple. No es un caso del happy path,
    // pero documenta el comportamiento defensivo.
    expect(hasMinRole('trabajador', 'pirata')).toBe(true);
  });
});

describe('ROLE_LEVELS / ROLE_LABELS', () => {
  test('jerarquía esperada: trabajador < encargado < supervisor = rrhh < administrador', () => {
    expect(ROLE_LEVELS.trabajador).toBeLessThan(ROLE_LEVELS.encargado);
    expect(ROLE_LEVELS.encargado).toBeLessThan(ROLE_LEVELS.supervisor);
    expect(ROLE_LEVELS.supervisor).toBe(ROLE_LEVELS.rrhh);
    expect(ROLE_LEVELS.supervisor).toBeLessThan(ROLE_LEVELS.administrador);
  });

  test('cada rol con nivel tiene label legible', () => {
    for (const role of Object.keys(ROLE_LEVELS)) {
      expect(typeof ROLE_LABELS[role]).toBe('string');
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
  });
});
