// Constantes + helpers puros del módulo de agroquímicos (Existencias).
// Todo lo que no depende de React vive acá para mantener la página fina y
// evitar que los límites/listas se dupliquen entre la grilla y el modal de
// edición. EditProductoModal importa TIPOS/MONEDAS de acá; su tabla LIMITS
// usa otra forma (min/max/exclusive/required) porque valida en blur, no en
// lote — son contratos distintos a propósito.

export const TIPOS = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];
export const MONEDAS = ['USD', 'CRC', 'EUR'];

// Definición completa de columnas de la grilla. `id` = `key` para alimentar
// useTableColumnPreset (que indexa por `id`); el resto del código usa `key`.
export const COLUMNS = [
  { key: 'idProducto',            label: 'ID Producto',        thClass: 'pg-col-id',        defaultVisible: true                        },
  { key: 'nombreComercial',       label: 'Nombre Comercial',   thClass: 'pg-col-name',      defaultVisible: true,  required: true       },
  { key: 'ingredienteActivo',     label: 'Ingrediente Activo', thClass: 'pg-col-ing',       defaultVisible: true                        },
  { key: 'tipo',                  label: 'Tipo',               thClass: 'pg-col-tipo',      defaultVisible: true                        },
  { key: 'plagaQueControla',      label: 'Plaga / Enfermedad', thClass: 'pg-col-plaga',     defaultVisible: true                        },
  { key: 'cantidadPorHa',         label: 'Dosis/Ha',           thClass: 'pg-col-dosis',     defaultVisible: true,  filterType: 'number' },
  { key: 'unidad',                label: 'Unidad',             thClass: 'pg-col-unidad',    defaultVisible: true                        },
  { key: 'periodoReingreso',      label: 'Reingreso (h)',      thClass: 'pg-col-reingreso', defaultVisible: false, filterType: 'number' },
  { key: 'periodoACosecha',       label: 'A Cosecha (días)',   thClass: 'pg-col-cosecha',   defaultVisible: false, filterType: 'number' },
  { key: 'stockActual',           label: 'Stock actual',       thClass: 'pg-col-stock',     defaultVisible: true,  required: true, filterType: 'number' },
  { key: 'stockMinimo',           label: 'Stock mínimo',       thClass: 'pg-col-stockmin',  defaultVisible: true,  filterType: 'number' },
  { key: 'precioUnitario',        label: 'Precio unitario',    thClass: 'pg-col-precio',    defaultVisible: true,  filterType: 'number' },
  { key: 'moneda',                label: 'Moneda',             thClass: 'pg-col-moneda',    defaultVisible: false                       },
  { key: 'iva',                   label: 'IVA (%)',            thClass: 'pg-col-iva',       defaultVisible: false, filterType: 'number' },
  { key: 'proveedor',             label: 'Proveedor',          thClass: 'pg-col-proveedor', defaultVisible: true                        },
  { key: 'registroFitosanitario', label: 'Reg. Fitosanitario', thClass: 'pg-col-registro',  defaultVisible: false                       },
  { key: 'observacion',           label: 'Observación',        thClass: 'pg-col-obs',       defaultVisible: false                       },
].map(c => ({ ...c, id: c.key }));

export const FIELD_LABELS = Object.fromEntries(COLUMNS.map(c => [c.key, c.label]));

// Ids del preset compacto = columnas visibles por defecto (incluye las required).
export const COMPACT_COL_IDS = COLUMNS.filter(c => c.defaultVisible).map(c => c.key);

// Campos numéricos editables EN LA GRILLA. `tipoCambio` no es columna de la
// grilla (solo se edita en EditProductoModal), por eso no va acá ni en NUM_LIMITS.
export const NUM_FIELDS = ['cantidadPorHa', 'periodoReingreso', 'periodoACosecha', 'stockMinimo', 'precioUnitario', 'iva'];

export const MAX_LENGTHS = {
  idProducto: 32, nombreComercial: 64, ingredienteActivo: 64, plagaQueControla: 128,
  unidad: 40, proveedor: 128, registroFitosanitario: 32, observacion: 288,
};

export const NUM_LIMITS = {
  cantidadPorHa: 2048, periodoReingreso: 512, periodoACosecha: 512,
  stockMinimo: 32768, precioUnitario: 2097152, iva: 100,
};

// Comparación canónica "valor editado ≠ valor persistido". String-compare para
// no marcar dirty un 5 vs "5". Una sola fuente para dirtyProducts, isDirtyRow,
// changeSummary y el armado del payload.
export const fieldChanged = (val, persisted) => String(val) !== String(persisted ?? '');

// Valida un único campo editado. Devuelve mensaje de error (string) o null.
// Misma lógica que usa la grilla inline y la validación previa al guardado, así
// no divergen. Acepta '' / null como "sin valor" → válido (no obliga a llenar).
export function validateProductField(field, val) {
  const ml = MAX_LENGTHS[field];
  if (ml && String(val ?? '').length > ml) return `Máx ${ml} caracteres`;
  const nl = NUM_LIMITS[field];
  if (nl !== undefined && val !== '' && val != null) {
    const n = parseFloat(val);
    if (isNaN(n)) return 'Debe ser un número';
    if (n < 0) return 'No puede ser negativo';
    if (n > nl) return `Máx ${nl}`;
  }
  return null;
}
