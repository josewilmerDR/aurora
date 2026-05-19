/**
 * Unit tests for validateUserPayload + cleanRestrictedTo.
 *
 * These functions are the gatekeeper for the User/Employee facet invariants:
 * a user doc must end up with at least one of (tieneAcceso, empleadoPlanilla)
 * true, and tieneAcceso=true requires both a valid email and a non-'ninguno'
 * rol. Tests below pin each rule so a regression in the cross-field logic
 * shows up here rather than at the API edge.
 */

const { validateUserPayload, cleanRestrictedTo } = require('../../routes/users.shared');

describe('validateUserPayload — create mode', () => {
  test('accepts a payroll-only person without email or rol', () => {
    const { errs, clean } = validateUserPayload(
      { nombre: 'Juan Pérez', empleadoPlanilla: true },
      { mode: 'create' },
    );
    expect(errs).toEqual([]);
    expect(clean.tieneAcceso).toBe(false);
    expect(clean.empleadoPlanilla).toBe(true);
    expect(clean.rol).toBe('ninguno');
    expect(clean.email).toBe('');
  });

  test('accepts a system user with valid email and rol', () => {
    const { errs, clean } = validateUserPayload(
      { nombre: 'Ana García', email: 'ana@finca.com', rol: 'encargado', tieneAcceso: true },
      { mode: 'create' },
    );
    expect(errs).toEqual([]);
    expect(clean.tieneAcceso).toBe(true);
    expect(clean.rol).toBe('encargado');
    expect(clean.email).toBe('ana@finca.com');
  });

  test('rejects orphan state (no access AND no planilla)', () => {
    const { errs } = validateUserPayload(
      { nombre: 'Orfana', telefono: '8888-0000' },
      { mode: 'create' },
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(' ')).toMatch(/acceso al sistema o estar en planilla/i);
  });

  test('rejects tieneAcceso=true without email', () => {
    const { errs } = validateUserPayload(
      { nombre: 'Carlos', tieneAcceso: true, rol: 'trabajador' },
      { mode: 'create' },
    );
    expect(errs.join(' ')).toMatch(/Email inválido.*requerido/i);
  });

  test('rejects tieneAcceso=true with rol=ninguno', () => {
    const { errs } = validateUserPayload(
      { nombre: 'María', email: 'maria@finca.com', tieneAcceso: true, rol: 'ninguno' },
      { mode: 'create' },
    );
    expect(errs.join(' ')).toMatch(/Rol inválido/i);
  });

  test('accepts both facets simultaneously (typical worker)', () => {
    const { errs, clean } = validateUserPayload(
      { nombre: 'Pedro', email: 'pedro@finca.com', rol: 'trabajador', tieneAcceso: true, empleadoPlanilla: true },
      { mode: 'create' },
    );
    expect(errs).toEqual([]);
    expect(clean.tieneAcceso).toBe(true);
    expect(clean.empleadoPlanilla).toBe(true);
  });

  test('lowercases and trims the email', () => {
    const { clean } = validateUserPayload(
      { nombre: 'Luis', email: '  Luis@Finca.COM  ', rol: 'trabajador', tieneAcceso: true },
      { mode: 'create' },
    );
    expect(clean.email).toBe('luis@finca.com');
  });

  test('rejects nombre shorter than 2 characters', () => {
    const { errs } = validateUserPayload(
      { nombre: 'A', empleadoPlanilla: true },
      { mode: 'create' },
    );
    expect(errs.join(' ')).toMatch(/Nombre.*caracteres/);
  });

  test('rejects payroll-only with malformed email when email is provided', () => {
    // Even though email is optional for payroll-only people, a garbage value
    // is still rejected — silently storing junk would surprise admins later.
    const { errs } = validateUserPayload(
      { nombre: 'Carmen', email: 'not-an-email', empleadoPlanilla: true },
      { mode: 'create' },
    );
    expect(errs.join(' ')).toMatch(/Email inválido/);
  });

  test('forces rol=ninguno when tieneAcceso=false even if rol provided', () => {
    const { clean } = validateUserPayload(
      { nombre: 'Sin acceso', rol: 'administrador', empleadoPlanilla: true },
      { mode: 'create' },
    );
    expect(clean.rol).toBe('ninguno');
  });
});

describe('validateUserPayload — update mode', () => {
  test('orphan state is not auto-rejected in update mode (route handler covers it separately)', () => {
    // Update-mode is invoked with a merged state from the PUT handler, which
    // separately refuses the orphan transition. The validator itself only
    // checks the per-field invariants in update mode.
    const { errs } = validateUserPayload(
      { nombre: 'Same name', tieneAcceso: false, empleadoPlanilla: false },
      { mode: 'update' },
    );
    expect(errs).toEqual([]);
  });

  test('still rejects tieneAcceso=true without email in update mode', () => {
    const { errs } = validateUserPayload(
      { nombre: 'Pedro', tieneAcceso: true, rol: 'trabajador' },
      { mode: 'update' },
    );
    expect(errs.length).toBeGreaterThan(0);
  });
});

describe('cleanRestrictedTo', () => {
  test('returns null when input is not an array', () => {
    expect(cleanRestrictedTo(undefined)).toBeNull();
    expect(cleanRestrictedTo('admin')).toBeNull();
    expect(cleanRestrictedTo({ admin: true })).toBeNull();
  });

  test('drops unknown module ids and dedupes the result', () => {
    const result = cleanRestrictedTo(['admin', 'admin', 'pretend-module', 'bodega']);
    expect(Array.isArray(result)).toBe(true);
    // Order is sorted alphabetically; 'pretend-module' is dropped.
    expect(result).toContain('admin');
    expect(result).not.toContain('pretend-module');
    // Dedupe works.
    expect(result.filter(v => v === 'admin').length).toBe(1);
  });

  test('returns sorted output', () => {
    const result = cleanRestrictedTo(['bodega', 'admin']);
    expect(result).toEqual([...result].sort());
  });

  test('drops non-string entries silently', () => {
    const result = cleanRestrictedTo(['admin', null, 42, undefined, { admin: 1 }]);
    expect(result).toEqual(['admin']);
  });
});
