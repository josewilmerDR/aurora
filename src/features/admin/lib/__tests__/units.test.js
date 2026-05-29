import { describe, it, expect } from 'vitest';
import {
  formatPrecio,
  normalizeText,
  isDirtyForm,
  sortUnitsByNombre,
  upsertUnit,
  conversionIncomplete,
} from '../units';

const emptyForm = {
  nombre: '', descripcion: '', precio: '', labor: '', factorConversion: '', unidadBase: '',
};

describe('formatPrecio', () => {
  it('devuelve null para vacío o no numérico', () => {
    expect(formatPrecio('')).toBeNull();
    expect(formatPrecio(null)).toBeNull();
    expect(formatPrecio(undefined)).toBeNull();
    expect(formatPrecio('abc')).toBeNull();
  });
  it('antepone ₡ y formatea con 2 decimales', () => {
    // Aserción robusta al separador de locale (ICU puede variar): chequea el
    // símbolo y los dígitos (1500 + dos decimales → "150000").
    const f = formatPrecio(1500);
    expect(f.startsWith('₡')).toBe(true);
    expect(f.replace(/\D/g, '')).toBe('150000');
    expect(formatPrecio(0).replace(/\D/g, '')).toBe('000');
  });
});

describe('normalizeText', () => {
  it('quita acentos y baja a lowercase', () => {
    expect(normalizeText('Hectárea')).toBe('hectarea');
    expect(normalizeText('JORNAL')).toBe('jornal');
    expect(normalizeText(null)).toBe('');
  });
});

describe('isDirtyForm', () => {
  it('false con el form vacío', () => {
    expect(isDirtyForm(emptyForm)).toBe(false);
  });
  it('true si algún campo tiene contenido', () => {
    expect(isDirtyForm({ ...emptyForm, nombre: 'Kg' })).toBe(true);
    expect(isDirtyForm({ ...emptyForm, precio: '10' })).toBe(true);
    expect(isDirtyForm({ ...emptyForm, labor: 'lab1' })).toBe(true);
  });
  it('ignora espacios en blanco', () => {
    expect(isDirtyForm({ ...emptyForm, nombre: '   ' })).toBe(false);
  });
});

describe('sortUnitsByNombre', () => {
  it('ordena alfabéticamente sin mutar el original', () => {
    const list = [{ nombre: 'Saco' }, { nombre: 'Kg' }, { nombre: 'Ha' }];
    const sorted = sortUnitsByNombre(list);
    expect(sorted.map(u => u.nombre)).toEqual(['Ha', 'Kg', 'Saco']);
    expect(list[0].nombre).toBe('Saco'); // no muta
  });
});

describe('upsertUnit', () => {
  it('inserta un doc nuevo y reordena', () => {
    const list = [{ id: 'a', nombre: 'Kg' }];
    const next = upsertUnit(list, { id: 'b', nombre: 'Ha' });
    expect(next.map(u => u.id)).toEqual(['b', 'a']);
  });
  it('actualiza un doc existente por id (merge de campos)', () => {
    const list = [{ id: 'a', nombre: 'Kg', precio: 1 }];
    const next = upsertUnit(list, { id: 'a', nombre: 'Kg', precio: 2 });
    expect(next).toHaveLength(1);
    expect(next[0].precio).toBe(2);
  });
});

describe('conversionIncomplete', () => {
  it('false cuando ambos vacíos o ambos completos', () => {
    expect(conversionIncomplete('', '')).toBe(false);
    expect(conversionIncomplete('45', 'Kg')).toBe(false);
  });
  it('true cuando sólo uno está completo', () => {
    expect(conversionIncomplete('45', '')).toBe(true);
    expect(conversionIncomplete('', 'Kg')).toBe(true);
  });
});
