// Categorías de presupuesto — fuente única de verdad en el frontend.
// Keys iguales a las categorías en functions/lib/finance/categories.js.
export const BUDGET_CATEGORY_OPTIONS = [
  { value: 'combustible',      label: 'Combustible' },
  { value: 'depreciacion',     label: 'Depreciación' },
  { value: 'planilla_directa', label: 'Planilla directa' },
  { value: 'planilla_fija',    label: 'Planilla fija' },
  { value: 'insumos',          label: 'Insumos' },
  { value: 'mantenimiento',    label: 'Mantenimiento' },
  { value: 'administrativo',   label: 'Administrativo' },
  { value: 'otro',             label: 'Otro' },
];

export const BUDGET_CATEGORY_LABELS = Object.fromEntries(
  BUDGET_CATEGORY_OPTIONS.map(o => [o.value, o.label])
);
