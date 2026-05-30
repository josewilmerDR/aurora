// Validación de payloads del Centro de Costos con Zod. Sin Firestore, sin side
// effects — single source of truth de lo que aceptan los endpoints de escritura.
//
// Convención del estándar (docs/code-standards.md §3). El módulo de costos es
// hoy un solo archivo (functions/routes/costs.js); este sibling extrae las
// schemas para mantener los handlers delgados (parse → validate → DB) sin
// arrastrar la migración completa a carpeta de dominio.

const { z } = require('zod');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Categorías permitidas — espejo de CATEGORIAS_INDIRECTO en el frontend
// (src/features/costs/pages/CostCenter.jsx). El backend es el límite real:
// sin este enum, un PUT/POST directo escribe cualquier string que luego cae
// como categoría arbitraria en la UI.
const CATEGORIAS_INDIRECTO = ['mantenimiento', 'administrativo', 'otro'];

// Tipos de snapshot — espejo de SnapshotModal (manual | mensual).
const TIPOS_SNAPSHOT = ['manual', 'mensual'];

// Cota de montos: positivo y finito, con techo holgado (1e12) que descarta
// valores absurdos/overflow sin estorbar a una finca real.
const MAX_MONTO = 1e12;

// Cota de filas por snapshot. Una finca real no tiene miles de lotes/bloques;
// el tope evita que un POST directo infle el doc hasta el límite de 1 MB de
// Firestore.
const MAX_ROWS = 2000;

const num = z.number().finite();
const numNullable = z.number().finite().nullable();

// ─── Indirectos ───────────────────────────────────────────────────────────────

const indirectoCreateSchema = z.object({
  fecha: z.string().regex(DATE_RE, 'fecha must be YYYY-MM-DD'),
  categoria: z.enum(CATEGORIAS_INDIRECTO),
  descripcion: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().slice(0, 500) : ''),
    z.string().max(500),
  ),
  monto: z.coerce.number().finite('monto must be a finite number').nonnegative('monto must be >= 0').max(MAX_MONTO),
}).strict();

// PUT parcial: cada clave es opcional pero, si viene, se valida igual.
const indirectoUpdateSchema = indirectoCreateSchema.partial();

// ─── Snapshots ──────────────────────────────────────────────────────────────

// Shape exacto del agregado que emite GET /api/costos/live. `.strict()` en cada
// nivel actúa como whitelist: descarta cualquier campo inyectado que no sea
// parte del modelo de costos.
const desgloseSchema = z.object({
  combustible: num,
  planilla: num,
  insumos: num,
  depreciacion: num,
  indirectos: num,
}).strict();

const resumenSchema = z.object({
  costoTotal: num,
  kgTotal: num,
  costoPorKg: numNullable,
  combustible: num,
  planilla: num,
  insumos: num,
  depreciacion: num,
  indirectos: num,
}).strict();

const STR = z.string().max(200);

const loteRowSchema = z.object({
  loteId: STR,
  nombre: STR,
  desglose: desgloseSchema,
  costoTotal: num,
  kg: num,
  costoPorKg: numNullable,
}).strict();

const grupoRowSchema = z.object({
  loteId: STR,
  loteNombre: STR,
  grupo: STR,
  desglose: desgloseSchema,
  costoTotal: num,
  kg: num,
  costoPorKg: numNullable,
}).strict();

const bloqueRowSchema = z.object({
  loteId: STR,
  loteNombre: STR,
  grupo: STR.nullable(),
  bloqueId: STR,
  bloque: STR,
  desglose: desgloseSchema,
  costoTotal: num,
  kg: num,
  costoPorKg: numNullable,
}).strict();

const snapshotCreateSchema = z.object({
  nombre: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1, 'nombre is required').max(120),
  ),
  tipo: z.enum(TIPOS_SNAPSHOT).optional().default('manual'),
  rangoFechas: z.object({
    desde: z.string().regex(DATE_RE, 'rangoFechas.desde must be YYYY-MM-DD'),
    hasta: z.string().regex(DATE_RE, 'rangoFechas.hasta must be YYYY-MM-DD'),
  }).strict(),
  resumen: resumenSchema,
  porLote: z.array(loteRowSchema).max(MAX_ROWS).optional().default([]),
  porGrupo: z.array(grupoRowSchema).max(MAX_ROWS).optional().default([]),
  porBloque: z.array(bloqueRowSchema).max(MAX_ROWS).optional().default([]),
}).strict();

// ─── Wrapper ──────────────────────────────────────────────────────────────────

// Valida `body` contra `schema`. Devuelve { data } con solo las claves válidas
// (whitelist vía `.strict()`), o { error } con el primer mensaje en inglés
// (→ 400). Igual contrato que buildConfigUpdate en config/schemas.js.
function validateBody(schema, body) {
  const parsed = schema.safeParse(body || {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.length ? `${first.path.join('.')}: ` : '';
    return { error: first ? `${path}${first.message}` : 'Invalid payload.' };
  }
  return { data: parsed.data };
}

module.exports = {
  validateBody,
  indirectoCreateSchema,
  indirectoUpdateSchema,
  snapshotCreateSchema,
  CATEGORIAS_INDIRECTO,
  TIPOS_SNAPSHOT,
};
