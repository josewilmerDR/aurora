// Validación de payloads de config/{fincaId} con Zod. Sin Firestore, sin side
// effects.
//
// Convención del estándar (docs/code-standards.md §3): un solo archivo de
// schemas por dominio. Expone la schema declarativa + un wrapper
// `buildConfigUpdate(body)` que devuelve `{ data, logo, error }` con mensajes
// en inglés. El handler en index.js queda delgado: parse → validate → DB.
//
// NOTA DE SINCRONÍA: estas claves son ESPEJO de las que editan dos páginas del
// frontend — src/features/admin/pages/Parameters.jsx (tiempos de cosecha +
// producción) y src/features/account/pages/AccountSettings.jsx (identidad +
// díasIDesarrollo/IIDesarrollo/PostForza, logo). No hay módulo compartido
// FE↔BE, así que al sumar/cambiar un parámetro o un rango hay que tocar ambos
// lados. El PUT es una actualización PARCIAL: cada página manda un subconjunto
// disjunto de claves, así que todo es opcional y solo se mergea lo enviado.

const { z } = require('zod');

// Longitud máxima de los campos de identidad/contacto. Se aplica server-side
// porque estos strings se embeben en los PDFs de Lotes/Grupos/Cédulas: un valor
// sin cota es abuso de almacenamiento + payload de inyección al motor de PDF.
const STR_MAX = 200;

// Logo: el frontend ya valida tipo/tamaño antes de subir, pero el endpoint es
// alcanzable por API directa. Aceptamos solo imágenes y capamos el tamaño
// decodificado (~2 MB, igual que el límite de la UI en AccountSettings).
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

// Rangos numéricos por clave. Son la red de seguridad del servidor: el front ya
// valida [min, max], pero un PUT directo (o un bug) podría escribir mortalidad
// 5000% o días negativos y envenenar proyecciones/KPIs de toda la plataforma.
// Los días se capan a 10 años; los porcentajes a [0,100] (>100 daba Kg
// negativos). Mirror de los min/max de parameters.js + AccountSettings.
const MAX_DIAS = 3650;
const NUMERIC_RANGES = {
  diasIDesarrollo:      { min: 1, max: MAX_DIAS, int: true },
  diasIIDesarrollo:     { min: 1, max: MAX_DIAS, int: true },
  diasPostForza:        { min: 1, max: MAX_DIAS, int: true },
  diasSiembraICosecha:  { min: 1, max: MAX_DIAS, int: true },
  diasForzaICosecha:    { min: 1, max: MAX_DIAS, int: true },
  diasChapeaIICosecha:  { min: 1, max: MAX_DIAS, int: true },
  diasForzaIICosecha:   { min: 1, max: MAX_DIAS, int: true },
  diasChapeaIIICosecha: { min: 1, max: MAX_DIAS, int: true },
  diasForzaIIICosecha:  { min: 1, max: MAX_DIAS, int: true },
  plantasPorHa:   { min: 1, max: 1_000_000, int: true },
  kgPorCaja:      { min: 0, max: 10_000 },
  kgPorPlanta:    { min: 0, max: 1_000 },
  kgPorPlantaII:  { min: 0, max: 1_000 },
  kgPorPlantaIII: { min: 0, max: 1_000 },
  rechazoICosecha:      { min: 0, max: 100 },
  rechazoIICosecha:     { min: 0, max: 100 },
  rechazoIIICosecha:    { min: 0, max: 100 },
  mortalidadICosecha:   { min: 0, max: 100 },
  mortalidadIICosecha:  { min: 0, max: 100 },
  mortalidadIIICosecha: { min: 0, max: 100 },
};

const CONFIG_STRING_KEYS = [
  'nombreEmpresa', 'identificacion', 'representanteLegal', 'administrador',
  'direccion', 'whatsapp',
];

// ─── Fragmentos reutilizables ────────────────────────────────────────────────

// String opcional: trim + truncado a max. Si el cliente omite la clave o manda
// algo que no es string, queda `undefined` y no se mergea al doc.
const optionalString = (max = STR_MAX) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined),
    z.string().max(max).optional(),
  );

// Correo opcional: el form lo manda vacío cuando no se llena, así que aceptamos
// '' o un email válido. Formato bien definido → seguro de validar (a diferencia
// del teléfono, cuyo formato libre solo capamos por longitud).
const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().slice(0, STR_MAX) : undefined),
  z.union([z.literal(''), z.string().email('correo must be a valid email')]).optional(),
);

// Numérico opcional acotado a [min,max] (y entero si int). Vacío/null/ausente →
// undefined (no se mergea). No finito o fuera de rango → issue de validación.
const numericField = ({ min, max, int }) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number()
      .refine(Number.isFinite, 'must be a finite number')
      .refine((n) => n >= min && n <= max, `must be between ${min} and ${max}`)
      .refine((n) => !int || Number.isInteger(n), 'must be an integer')
      .optional(),
  );

// ─── Schema ──────────────────────────────────────────────────────────────────

const configShape = {
  correo: optionalEmail,
  logoBase64: z.string().optional(),
  mediaType: z.string().optional(),
};
for (const key of CONFIG_STRING_KEYS) configShape[key] = optionalString();
for (const [key, range] of Object.entries(NUMERIC_RANGES)) configShape[key] = numericField(range);

// `.strict()` no — claves desconocidas se descartan en silencio (whitelist),
// preservando el comportamiento previo del for-loop sobre CONFIG_*_KEYS.
const configUpdateSchema = z.object(configShape).superRefine((obj, ctx) => {
  if (obj.logoBase64 === undefined) return;
  const b64 = obj.logoBase64;
  if (typeof b64 !== 'string' || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['logoBase64'], message: 'logoBase64 must be valid base64' });
    return;
  }
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const bytes = (b64.length / 4) * 3 - padding;
  if (bytes > MAX_LOGO_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['logoBase64'], message: 'logo exceeds the 2MB limit' });
  }
  if (!ALLOWED_LOGO_TYPES.has(obj.mediaType)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mediaType'], message: 'mediaType must be image/png, image/jpeg or image/webp' });
  }
});

// ─── Wrapper ──────────────────────────────────────────────────────────────────

// Valida el body del PUT. Devuelve:
//   { error }              — mensaje en inglés del primer issue (→ 400)
//   { data, logo }         — `data`: solo las claves enviadas y válidas, listas
//                            para `set(..., {merge:true})`. `logo`: {base64,
//                            mediaType} si se subió uno, o null. logoBase64/
//                            mediaType NUNCA van a `data` (se procesan a logoUrl).
function buildConfigUpdate(body) {
  const parsed = configUpdateSchema.safeParse(body || {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.length ? `${first.path.join('.')}: ` : '';
    return { error: first ? `${path}${first.message}` : 'Invalid config payload.' };
  }
  const { logoBase64, mediaType, ...rest } = parsed.data;
  const data = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) data[k] = v;
  }
  const logo = logoBase64 !== undefined ? { base64: logoBase64, mediaType } : null;
  return { data, logo };
}

module.exports = { buildConfigUpdate, configUpdateSchema };
