// Validación de payloads de bodegas (items + movimientos) con Zod. Sin
// Firestore, sin side effects. Single source of truth para los tipos/rangos
// que aceptan los handlers de warehouses.js.
//
// Convención (docs/code-standards.md §3): cada schema expone un wrapper
// `buildXxx(body)` que devuelve `{ data, error }` con mensajes en inglés
// (el frontend los mapea por `code`, no por texto).
//
// Nota de seguridad: los campos *Nombre (loteNombre, laborNombre,
// activoNombre, operarioNombre) NO se aceptan del cliente. Se resuelven en el
// backend leyendo el doc por ID con filtro de finca, para que la trazabilidad
// del movimiento no dependa de un string arbitrario enviado por el navegador.

const { z } = require('zod');

const VALID_CURRENCIES = new Set(['USD', 'CRC', 'EUR']);
const VALID_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const MAX_NAME = 200;
const MAX_DESC = 500;
const MAX_UNIT = 50;
const MAX_DOC = 100;   // factura / oc
const MAX_ID = 128;
const MAX_AMOUNT = 1e12;
const MAX_BINARY = 5 * 1024 * 1024;          // 5 MB de adjunto decodificado
const MAX_BASE64 = Math.ceil(MAX_BINARY / 3) * 4; // su equivalente en caracteres base64

// Largo en bytes del binario que representa una cadena base64 (descontando
// padding). Sirve para limitar por tamaño real, no por largo del string.
const base64ByteLength = (s) => {
  const len = s.length;
  const padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (len * 3) / 4 - padding;
};

// ─── Fragmentos reutilizables ──────────────────────────────────────────────

// Recorta y limita un string libre; '' cuando no es string.
const trimmedString = (max) =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, max) : ''), z.string());

// Número >= 0 finito; '' / null / undefined → 0 (campos de stock opcionales).
const nonNegativeOrZero = z.unknown().transform((v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return !Number.isFinite(n) || n < 0 ? 0 : n;
});

// Total nullable: '' / null → null; cualquier otro valor debe ser número >= 0.
const nullableTotal = z.unknown().transform((v, ctx) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Total must be a valid number >= 0.' });
    return z.NEVER;
  }
  return n;
});

const currency = z.unknown().transform((v) => (VALID_CURRENCIES.has(v) ? v : 'CRC'));

const optionalId = trimmedString(MAX_ID);

// ─── Schemas ───────────────────────────────────────────────────────────────

const itemCreateSchema = z.object({
  nombre: trimmedString(MAX_NAME).refine((s) => s.length > 0, { message: 'Item name is required.' }),
  unidad: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_UNIT) : 'unidad'),
    z.string(),
  ),
  stockActual: nonNegativeOrZero,
  stockMinimo: nonNegativeOrZero,
  descripcion: trimmedString(MAX_DESC),
  total: nullableTotal,
  moneda: currency,
});

const itemUpdateSchema = z.object({
  nombre: trimmedString(MAX_NAME).refine((s) => s.length > 0, { message: 'Name cannot be empty.' }).optional(),
  unidad: trimmedString(MAX_UNIT).optional(),
  stockMinimo: nonNegativeOrZero.optional(),
  descripcion: trimmedString(MAX_DESC).optional(),
  activo: z.boolean().optional(),
  total: nullableTotal.optional(),
  moneda: currency.optional(),
}).strip();

const movementCreateSchema = z.object({
  itemId: optionalId.refine((s) => s.length > 0, { message: 'itemId is required.' }),
  tipo: z.enum(['entrada', 'salida'], { message: 'tipo must be "entrada" or "salida".' }),
  cantidad: z.unknown().transform((v, ctx) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Quantity must be a positive finite number.' });
      return z.NEVER;
    }
    return n;
  }),
  nota: trimmedString(MAX_DESC),
  // IDs de referencia: los nombres NO se aceptan del cliente (se resuelven en
  // el backend). Cualquier *Nombre enviado se descarta vía .strip().
  loteId: optionalId,
  laborId: optionalId,
  activoId: optionalId,
  operarioId: optionalId,
  factura: trimmedString(MAX_DOC),
  oc: trimmedString(MAX_DOC),
  total: nullableTotal,
  // Clave de idempotencia opcional generada por el cliente: evita doble
  // registro ante reintentos de red o doble submit. Se usa como doc ID.
  clientMovId: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_ID) : ''),
    z.string().regex(/^[A-Za-z0-9_-]*$/, { message: 'clientMovId has invalid characters.' }),
  ),
  imageBase64: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string()
      .max(MAX_BASE64, { message: 'Attachment too large (max 5 MB).' })
      .refine((s) => s === '' || /^[A-Za-z0-9+/]+={0,2}$/.test(s), { message: 'Attachment is not valid base64.' })
      .refine((s) => s === '' || base64ByteLength(s) <= MAX_BINARY, { message: 'Attachment too large (max 5 MB).' }),
  ),
  mediaType: z.unknown().transform((v) => (VALID_MEDIA.has(v) ? v : 'image/jpeg')),
}).strip();

// ─── Wrappers ──────────────────────────────────────────────────────────────

function firstIssue(result) {
  return result.error?.issues?.[0]?.message || 'Invalid input.';
}

function buildItemCreate(body) {
  const r = itemCreateSchema.safeParse(body || {});
  return r.success ? { data: r.data } : { error: firstIssue(r) };
}

function buildItemUpdate(body) {
  const r = itemUpdateSchema.safeParse(body || {});
  return r.success ? { data: r.data } : { error: firstIssue(r) };
}

function buildMovementCreate(body) {
  const r = movementCreateSchema.safeParse(body || {});
  return r.success ? { data: r.data } : { error: firstIssue(r) };
}

module.exports = {
  buildItemCreate,
  buildItemUpdate,
  buildMovementCreate,
  VALID_MEDIA,
};
