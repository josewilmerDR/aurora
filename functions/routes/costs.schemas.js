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

// El cliente solo nombra el snapshot y elige el rango. Los agregados
// (resumen/porLote/porGrupo/porBloque) NO se aceptan del payload: el backend
// los recomputa con computeLiveCosts() al momento de guardar, así el snapshot
// congela el cálculo del propio servidor y no un número fabricado por el
// cliente. Ver functions/routes/costs.js (POST /api/costos/snapshots).
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
  DATE_RE,
};
