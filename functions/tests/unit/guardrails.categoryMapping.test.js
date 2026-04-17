// Unit tests for supplier → budget category mapping. Pure.

const {
  SUPPLIER_TO_BUDGET,
  supplierCategoryToBudget,
  resolveBudgetCategory,
} = require('../../lib/finance/categoryMapping');

describe('supplierCategoryToBudget', () => {
  test('known mappings', () => {
    expect(supplierCategoryToBudget('combustible')).toBe('combustible');
    expect(supplierCategoryToBudget('agroquimicos')).toBe('insumos');
    expect(supplierCategoryToBudget('fertilizantes')).toBe('insumos');
    expect(supplierCategoryToBudget('semillas')).toBe('insumos');
    expect(supplierCategoryToBudget('maquinaria')).toBe('mantenimiento');
    expect(supplierCategoryToBudget('servicios')).toBe('mantenimiento');
    expect(supplierCategoryToBudget('otros')).toBe('otro');
  });

  test('unknown or missing → null', () => {
    expect(supplierCategoryToBudget('viajes')).toBeNull();
    expect(supplierCategoryToBudget('')).toBeNull();
    expect(supplierCategoryToBudget(null)).toBeNull();
    expect(supplierCategoryToBudget(undefined)).toBeNull();
    expect(supplierCategoryToBudget(42)).toBeNull();
  });
});

describe('resolveBudgetCategory', () => {
  test('returns explicit budgetCategory when provided', () => {
    expect(resolveBudgetCategory({ budgetCategory: 'insumos' }, {})).toBe('insumos');
  });

  test('falls back to supplier mapping via proveedor.id', () => {
    const supplierMap = { 'prov-1': { categoria: 'combustible' } };
    expect(resolveBudgetCategory({ proveedor: { id: 'prov-1' } }, supplierMap)).toBe('combustible');
  });

  test('falls back to supplier mapping via proveedorId', () => {
    const supplierMap = { 'prov-2': { categoria: 'agroquimicos' } };
    expect(resolveBudgetCategory({ proveedorId: 'prov-2' }, supplierMap)).toBe('insumos');
  });

  test('null when no category can be resolved', () => {
    expect(resolveBudgetCategory({}, {})).toBeNull();
    expect(resolveBudgetCategory({ proveedor: { id: 'unknown' } }, {})).toBeNull();
  });

  test('null on non-object params', () => {
    expect(resolveBudgetCategory(null, {})).toBeNull();
    expect(resolveBudgetCategory('not-an-object', {})).toBeNull();
  });

  test('SUPPLIER_TO_BUDGET is immutable', () => {
    // Jest corre en modo no-strict; Object.freeze hace que los writes fallen
    // silenciosamente en vez de lanzar. Verificamos el efecto observable.
    expect(Object.isFrozen(SUPPLIER_TO_BUDGET)).toBe(true);
    try { SUPPLIER_TO_BUDGET.newKey = 'x'; } catch (_) { /* noop */ }
    expect(SUPPLIER_TO_BUDGET.newKey).toBeUndefined();
  });
});
