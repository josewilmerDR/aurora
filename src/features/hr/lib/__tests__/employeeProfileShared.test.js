import { describe, test, expect } from 'vitest';
import { validateForms, EMPTY_USER, EMPTY_FICHA } from '../employeeProfileShared';

// validateForms gates the EmployeeProfile submit. The rules around the
// tieneAcceso toggle are the load-bearing addition from paso 4: email and rol
// are required only when the toggle is on, but a syntactically wrong email
// is rejected either way. These tests pin those rules.

describe('EMPTY_USER defaults', () => {
  test('starts as payroll-only (no system access)', () => {
    expect(EMPTY_USER.tieneAcceso).toBe(false);
    expect(EMPTY_USER.rol).toBe('ninguno');
    expect(EMPTY_USER.email).toBe('');
  });
});

describe('validateForms — payroll-only mode (tieneAcceso=false)', () => {
  test('accepts a person with name but no email and no rol', () => {
    const errors = validateForms(
      { ...EMPTY_USER, nombre: 'Juan Pérez' },
      EMPTY_FICHA,
    );
    expect(errors.nombre).toBeUndefined();
    expect(errors.email).toBeUndefined();
    expect(errors.rol).toBeUndefined();
  });

  test('still rejects a malformed email even when access is off', () => {
    const errors = validateForms(
      { ...EMPTY_USER, nombre: 'Carmen Solís', email: 'not-an-email' },
      EMPTY_FICHA,
    );
    expect(errors.email).toBeDefined();
  });

  test('does not require rol when access is off', () => {
    const errors = validateForms(
      { ...EMPTY_USER, nombre: 'Sin rol' },
      EMPTY_FICHA,
    );
    expect(errors.rol).toBeUndefined();
  });
});

describe('validateForms — system user mode (tieneAcceso=true)', () => {
  test('requires email when access is on', () => {
    const errors = validateForms(
      { nombre: 'María', email: '', telefono: '', rol: 'trabajador', tieneAcceso: true },
      EMPTY_FICHA,
    );
    expect(errors.email).toMatch(/requerido/i);
  });

  test('rejects rol=ninguno when access is on', () => {
    const errors = validateForms(
      { nombre: 'Pedro', email: 'pedro@finca.com', telefono: '', rol: 'ninguno', tieneAcceso: true },
      EMPTY_FICHA,
    );
    expect(errors.rol).toBeDefined();
  });

  test('accepts valid email + non-ninguno rol when access is on', () => {
    const errors = validateForms(
      { nombre: 'Ana', email: 'ana@finca.com', telefono: '8888-1234', rol: 'encargado', tieneAcceso: true },
      EMPTY_FICHA,
    );
    expect(errors.email).toBeUndefined();
    expect(errors.rol).toBeUndefined();
  });
});

describe('validateForms — common field rules unaffected by access toggle', () => {
  test('nombre shorter than 2 chars fails regardless of access', () => {
    const off = validateForms({ ...EMPTY_USER, nombre: 'A' }, EMPTY_FICHA);
    const on = validateForms(
      { nombre: 'A', email: 'a@finca.com', telefono: '', rol: 'trabajador', tieneAcceso: true },
      EMPTY_FICHA,
    );
    expect(off.nombre).toBeDefined();
    expect(on.nombre).toBeDefined();
  });

  test('telefono with letters is rejected', () => {
    const errors = validateForms(
      { ...EMPTY_USER, nombre: 'Pedro', telefono: 'abc-def-ghij' },
      EMPTY_FICHA,
    );
    expect(errors.telefono).toBeDefined();
  });

  test('telefono is optional', () => {
    const errors = validateForms(
      { ...EMPTY_USER, nombre: 'Pedro', telefono: '' },
      EMPTY_FICHA,
    );
    expect(errors.telefono).toBeUndefined();
  });
});
