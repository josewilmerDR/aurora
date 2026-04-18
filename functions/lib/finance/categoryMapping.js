// Mapeo puro entre categorías de proveedor (proveedores.js) y categorías de
// budget (categories.js). Las llaves ya existen en español en Firestore y no
// se renombran — solo se traducen.

const SUPPLIER_TO_BUDGET = Object.freeze({
  combustible:   'combustible',
  agroquimicos:  'insumos',
  fertilizantes: 'insumos',
  semillas:      'insumos',
  maquinaria:    'mantenimiento',
  servicios:     'mantenimiento',
  otros:         'otro',
});

// Devuelve la categoría de budget correspondiente a una categoría de
// proveedor, o `null` si no se reconoce (causa: saltar el cap check).
function supplierCategoryToBudget(supplierCategory) {
  if (typeof supplierCategory !== 'string') return null;
  return SUPPLIER_TO_BUDGET[supplierCategory] ?? null;
}

// Resuelve la categoría de budget desde los parámetros de una acción de
// compra. Prioriza la explícita (`params.budgetCategory`), si no cae al
// mapeo por proveedor.
function resolveBudgetCategory(params, supplierMap = {}) {
  if (!params || typeof params !== 'object') return null;
  if (typeof params.budgetCategory === 'string' && params.budgetCategory) {
    return params.budgetCategory;
  }
  const supplierId = params.proveedor?.id || params.proveedorId || null;
  if (!supplierId) return null;
  const supplier = supplierMap[supplierId];
  if (!supplier) return null;
  return supplierCategoryToBudget(supplier.categoria);
}

module.exports = {
  SUPPLIER_TO_BUDGET,
  supplierCategoryToBudget,
  resolveBudgetCategory,
};
