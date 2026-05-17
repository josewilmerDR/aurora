import { describe, test, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlurValidation } from '../useBlurValidation';

// `validate` simula la firma esperada por el hook: recibe el form y retorna
// un objeto { field: 'error message' } sólo con los campos inválidos.
function validate(form) {
  const errs = {};
  if (!(form.email || '').includes('@')) errs.email = 'Email inválido';
  if ((form.nombre || '').length < 2)    errs.nombre = 'Muy corto';
  return errs;
}

describe('useBlurValidation', () => {
  test('arranca sin errores y inputClass devuelve la clase base', () => {
    const { result } = renderHook(() => useBlurValidation(validate));
    expect(result.current.fieldErrors).toEqual({});
    expect(result.current.inputClass('email')).toBe('aur-input');
    expect(result.current.inputClass('email', 'aur-select')).toBe('aur-select');
  });

  test('blurField solo persiste el error del campo blureado', () => {
    const { result } = renderHook(() => useBlurValidation(validate));
    const form = { email: 'no-at-sign', nombre: 'x' };
    act(() => { result.current.blurField('email', form); });
    // Sólo email queda registrado, aunque nombre también esté mal.
    expect(result.current.fieldErrors).toEqual({ email: 'Email inválido' });
  });

  test('inputClass agrega aur-input--error cuando el campo tiene error', () => {
    const { result } = renderHook(() => useBlurValidation(validate));
    act(() => { result.current.blurField('email', { email: '' }); });
    expect(result.current.inputClass('email')).toBe('aur-input aur-input--error');
  });

  test('blurField limpia el error si el campo pasa a ser válido', () => {
    const { result } = renderHook(() => useBlurValidation(validate));
    act(() => { result.current.blurField('email', { email: '' }); });
    expect(result.current.fieldErrors.email).toBeDefined();
    act(() => { result.current.blurField('email', { email: 'a@b.co' }); });
    expect(result.current.fieldErrors.email).toBeUndefined();
  });

  test('clearField borra un error específico', () => {
    const { result } = renderHook(() => useBlurValidation(validate));
    act(() => { result.current.blurField('email', { email: '' }); });
    act(() => { result.current.clearField('email'); });
    expect(result.current.fieldErrors.email).toBeUndefined();
  });

  test('validateAll setea todos los errores y retorna false', () => {
    const { result } = renderHook(() => useBlurValidation(validate));
    let valid;
    act(() => { valid = result.current.validateAll({ email: '', nombre: '' }); });
    expect(valid).toBe(false);
    expect(result.current.fieldErrors).toEqual({
      email: 'Email inválido',
      nombre: 'Muy corto',
    });
  });

  test('validateAll retorna true y limpia errores cuando el form es válido', () => {
    const { result } = renderHook(() => useBlurValidation(validate));
    // Primero ensucio el estado con un error
    act(() => { result.current.blurField('email', { email: '' }); });
    let valid;
    act(() => { valid = result.current.validateAll({ email: 'ok@ok.com', nombre: 'José' }); });
    expect(valid).toBe(true);
    expect(result.current.fieldErrors).toEqual({});
  });
});
