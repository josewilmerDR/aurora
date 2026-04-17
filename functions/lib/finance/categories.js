// Categorías compartidas entre budgets y la agregación de costos.
// Los valores (keys) se mantienen en español porque ya viven en Firestore
// (costos_indirectos.categoria, y las 5 agregaciones que hace costos.js).

// Categorías derivadas — las que costos.js calcula a partir de colecciones
// de operación (horimetro, cedulas, planillas).
const DERIVED_CATEGORIES = Object.freeze([
  'combustible',
  'depreciacion',
  'planilla_directa',
  'planilla_fija',
  'insumos',
]);

// Sub-categorías de costos_indirectos.categoria (entrada manual).
const INDIRECT_CATEGORIES = Object.freeze([
  'mantenimiento',
  'administrativo',
  'otro',
]);

// Todas las categorías válidas para un Budget.
const BUDGET_CATEGORIES = Object.freeze([
  ...DERIVED_CATEGORIES,
  ...INDIRECT_CATEGORIES,
]);

const BUDGET_CATEGORY_SET = new Set(BUDGET_CATEGORIES);

// Etiquetas legibles para UI — son de consumo frontend, pero viven aquí para
// que el backend pueda devolverlas en la respuesta de ejecución si se requiere.
const CATEGORY_LABELS = Object.freeze({
  combustible:      'Combustible',
  depreciacion:     'Depreciación',
  planilla_directa: 'Planilla directa',
  planilla_fija:    'Planilla fija',
  insumos:          'Insumos',
  mantenimiento:    'Mantenimiento',
  administrativo:   'Administrativo',
  otro:             'Otro',
});

module.exports = {
  DERIVED_CATEGORIES,
  INDIRECT_CATEGORIES,
  BUDGET_CATEGORIES,
  BUDGET_CATEGORY_SET,
  CATEGORY_LABELS,
};
