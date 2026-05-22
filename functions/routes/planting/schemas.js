// Validación de payloads del dominio planting (siembras + materiales) con Zod.
// Sin Firestore, sin side effects.
//
// Convención del estándar (docs/code-standards.md §3): un solo archivo de
// schemas por dominio. Expone schemas declarativas + wrappers `buildXDoc(body)`
// que devuelven `{ data, error }` con mensajes en inglés. Los handlers en
// materiales.js / siembras.js quedan delgados: parse → validate → DB.

const { z } = require('zod');

// ─── Constantes ────────────────────────────────────────────────────────────

// Field length limits enforced server-side to prevent storage abuse via
// direct API calls that bypass the UI.
const STR_LIMITS = {
  bloque: 4,
  loteId: 64,
  loteNombre: 200,
  materialId: 64,
  materialNombre: 200,
  variedad: 120,
  rangoPesos: 64,
};

const MAX_NUM_RANGE = 199999;

// ─── Reusable fragments ────────────────────────────────────────────────────

const isValidISODate = (s) => {
  if (typeof s !== 'string' || s.length < 8 || s.length > 32) return false;
  return !Number.isNaN(new Date(s).getTime());
};

// String trimmed + truncated to max. Empty string for non-string input. Used
// for optional fields where the UI may omit the property entirely.
const optionalString = (max) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().slice(0, max) : ''),
    z.string(),
  );

// Required non-empty string up to `max` chars.
const requiredString = (max, missingMsg, tooLongMsg) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, missingMsg).max(max, tooLongMsg),
  );

// Accepts any numeric-ish value, coerces to integer, enforces [0, 199999].
const intInRange = (message) =>
  z.unknown().transform((v, ctx) => {
    const n = parseInt(v);
    if (!Number.isFinite(n) || n < 0 || n > MAX_NUM_RANGE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return n;
  });

// Float variant of intInRange — same domain, accepts decimals.
const floatInRange = (message) =>
  z.unknown().transform((v, ctx) => {
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n < 0 || n > MAX_NUM_RANGE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return n;
  });

// Boolean from various truthy representations (true, 'true'). Anything else → false.
const truthyBool = z.unknown().transform((v) => v === true || v === 'true');

// Validated ISO date string (used by `fecha`, `desde`, `hasta`, etc.).
const isoDateString = (message) =>
  z.string().refine(isValidISODate, { message });

// densidadDefault: 0 means "not configured"; null means invalid input.
// Mirrors the legacy coerceDensidadDefault behavior.
const densidadDefault = z.unknown().transform((v, ctx) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > MAX_NUM_RANGE) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'densidadDefault must be 0–199999.' });
    return z.NEVER;
  }
  return n;
});

// ─── Materiales — POST + PUT comparten el mismo shape ────────────────────

const materialInputSchema = z.object({
  nombre: requiredString(32, 'Name is required.', 'Name too long.'),
  rangoPesos: optionalString(32),
  variedad: optionalString(32),
  densidadDefault,
});

function buildMaterialDoc(body) {
  const parsed = materialInputSchema.safeParse(body || {});
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  return { data: parsed.data };
}

// ─── Siembras — POST (create) ─────────────────────────────────────────────

const siembraCreateSchema = z.object({
  loteId: requiredString(STR_LIMITS.loteId, 'Lote and fecha are required.', 'loteId too long.'),
  fecha: isoDateString('Invalid fecha.'),
  loteNombre: optionalString(STR_LIMITS.loteNombre),
  bloque: optionalString(STR_LIMITS.bloque),
  plantas: intInRange('Plants out of valid range.'),
  densidad: floatInRange('Density out of valid range.'),
  materialId: optionalString(STR_LIMITS.materialId),
  materialNombre: optionalString(STR_LIMITS.materialNombre),
  rangoPesos: optionalString(STR_LIMITS.rangoPesos),
  variedad: optionalString(STR_LIMITS.variedad),
  cerrado: truthyBool.default(false),
});

function buildSiembraCreateDoc(body) {
  // Body-level pre-check kept for parity with the legacy 400 message which
  // signaled BOTH missing fields together; Zod's per-field error would
  // surface only the first one.
  if (!body || !body.loteId || !body.fecha) {
    return { error: 'Lote and fecha are required.' };
  }
  const parsed = siembraCreateSchema.safeParse(body);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  return { data: parsed.data };
}

// ─── Siembras — PUT (update; all fields optional) ────────────────────────

// Whitelist of editable fields. Anything else in the body is ignored — this
// is how we keep `responsableId`, `fincaId`, `createdAt`, etc. immutable.
const ALLOWED_UPDATE_KEYS = [
  'fecha', 'loteId', 'loteNombre', 'bloque',
  'plantas', 'densidad',
  'materialId', 'materialNombre', 'rangoPesos', 'variedad',
  'cerrado',
];

const siembraUpdateSchema = z.object({
  fecha: isoDateString('Invalid fecha.').optional(),
  loteId: optionalString(STR_LIMITS.loteId).optional(),
  loteNombre: optionalString(STR_LIMITS.loteNombre).optional(),
  bloque: optionalString(STR_LIMITS.bloque).optional(),
  plantas: intInRange('Plants out of valid range.').optional(),
  densidad: floatInRange('Density out of valid range.').optional(),
  materialId: optionalString(STR_LIMITS.materialId).optional(),
  materialNombre: optionalString(STR_LIMITS.materialNombre).optional(),
  rangoPesos: optionalString(STR_LIMITS.rangoPesos).optional(),
  variedad: optionalString(STR_LIMITS.variedad).optional(),
  cerrado: truthyBool.optional(),
});

function buildSiembraUpdateDoc(body) {
  // Pre-filter keys to the whitelist so the user can't sneak in fields like
  // `responsableId` or `fincaId`.
  const filtered = {};
  for (const key of ALLOWED_UPDATE_KEYS) {
    if (body && body[key] !== undefined) filtered[key] = body[key];
  }
  const parsed = siembraUpdateSchema.safeParse(filtered);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  return { data: parsed.data };
}

// ─── Siembras — GET query params ─────────────────────────────────────────

const siembraListQuerySchema = z.object({
  loteId: z.union([
    z.undefined(),
    z.string().max(STR_LIMITS.loteId, 'Invalid loteId.'),
  ]),
  desde: z.union([
    z.undefined(),
    isoDateString('Invalid "desde" date.'),
  ]),
  hasta: z.union([
    z.undefined(),
    isoDateString('Invalid "hasta" date.'),
  ]),
});

function buildSiembraListFilters(query) {
  const parsed = siembraListQuerySchema.safeParse(query || {});
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  return { data: parsed.data };
}

// ─── Siembras — POST /bulk (cap por payload) ─────────────────────────────

// Tope sano para una sola llamada del UI. Un save típico de Siembra.jsx son
// 1–5 filas; cualquier cosa por encima de 50 ya luce como script abuse y
// además se acerca al límite de Firestore batch (500 ops/batch).
const BULK_MAX_ROWS = 50;

module.exports = {
  // Wrappers — preferred entry points from handlers.
  buildMaterialDoc,
  buildSiembraCreateDoc,
  buildSiembraUpdateDoc,
  buildSiembraListFilters,
  // Schemas — exposed for tests and ad-hoc validation.
  materialInputSchema,
  siembraCreateSchema,
  siembraUpdateSchema,
  siembraListQuerySchema,
  // Constants.
  BULK_MAX_ROWS,
};
