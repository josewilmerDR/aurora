// Validador de payloads `credit_products` con Zod.
//
// Range policy (intencionalmente amplia para aceptar crédito agropecuario
// latinoamericano real): APR 0-80%, plazo 1-60 meses, monto hasta 1e9. Soporta
// los tres esquemas de amortización: cuota_fija | amortizacion_constante |
// bullet (sólo intereses mensuales, principal al vencimiento).
//
// Los chequeos individuales por campo viven en la schema de Zod; las reglas
// cross-field (min ≤ max, isInteger en plazos) se ejecutan en buildCreditProductDoc()
// después del parse. El orden en el que la schema declara los campos coincide
// con el orden de los chequeos del validador imperativo anterior, así
// `parsed.error.issues[0]` siempre corresponde al primer error que el código
// previo habría devuelto.

const { z } = require('zod');

const VALID_TIPOS = new Set(['agricola', 'capital_trabajo', 'leasing', 'rotativo']);
const VALID_PROVIDER_TYPES = new Set(['banco', 'cooperativa', 'microfinanciera', 'fintech']);
const VALID_ESQUEMAS = new Set(['cuota_fija', 'amortizacion_constante', 'bullet']);
const VALID_MONEDAS = new Set(['USD', 'CRC']);
const VALID_REQ_TIPOS = new Set(['documento', 'garantia', 'metrica']);

const MAX_NAME = 150;
const MAX_DESCRIPCION = 500;
const MAX_CODIGO = 64;
const MAX_REQUISITOS = 30;
const MAX_MONEDA = 1e9;
const MAX_APR = 0.80;   // 80% APR ceiling — productos reales raramente lo exceden.
const MIN_PLAZO = 1;
const MAX_PLAZO = 60;   // 5 años. Préstamos agropecuarios a más largo son raros.

// ─── Helpers ──────────────────────────────────────────────────────────────

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Valida un único requisito y devuelve el objeto normalizado o un código de
// error como string. Se exporta vía `_internals` para que los tests lo prueben
// directamente.
function normalizeRequisito(raw) {
  if (!raw || typeof raw !== 'object') return 'invalid_shape';
  const tipo = str(raw.tipo, 32);
  if (!VALID_REQ_TIPOS.has(tipo)) return 'invalid_tipo';
  const codigo = str(raw.codigo, MAX_CODIGO);
  if (!codigo) return 'missing_codigo';
  const descripcion = str(raw.descripcion, MAX_DESCRIPCION);
  if (!descripcion) return 'missing_descripcion';
  return { tipo, codigo, descripcion };
}

// ─── Reusable Zod fragments ───────────────────────────────────────────────

const enumOneOf = (validSet, fieldName) =>
  z.unknown().refine((v) => validSet.has(v), {
    message: `${fieldName} must be one of: ${[...validSet].join(', ')}.`,
  });

const moneyAmountField = (fieldName) =>
  z.unknown().transform((v, ctx) => {
    const n = num(v);
    if (n === null || n <= 0 || n > MAX_MONEDA) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldName} must be > 0.` });
      return z.NEVER;
    }
    return n;
  });

const plazoField = (fieldName) =>
  z.unknown().transform((v, ctx) => {
    const n = num(v);
    if (n === null || n < MIN_PLAZO || n > MAX_PLAZO) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldName} must be in [${MIN_PLAZO}, ${MAX_PLAZO}].`,
      });
      return z.NEVER;
    }
    return n;
  });

const aprField = (fieldName) =>
  z.unknown().transform((v, ctx) => {
    const n = num(v);
    if (n === null || n < 0 || n > MAX_APR) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldName} must be in [0, ${MAX_APR}] (decimal, e.g. 0.18 for 18%).`,
      });
      return z.NEVER;
    }
    return n;
  });

// Array de requisitos — usa normalizeRequisito por elemento para mantener una
// sola fuente de verdad sobre qué shape es válido.
const requisitosField = z.unknown().transform((raw, ctx) => {
  const arr = Array.isArray(raw) ? raw : [];
  if (arr.length > MAX_REQUISITOS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Too many requisitos (max ${MAX_REQUISITOS}).`,
    });
    return z.NEVER;
  }
  const out = [];
  for (let i = 0; i < arr.length; i += 1) {
    const r = normalizeRequisito(arr[i]);
    if (typeof r === 'string') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `requisitos[${i}] ${r}.` });
      return z.NEVER;
    }
    out.push(r);
  }
  return out;
});

const fuenteField = z.unknown().transform((v, ctx) => {
  const f = str(v, 64) || 'manual';
  if (f !== 'manual' && !f.startsWith('api:')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'fuente must be "manual" or start with "api:".',
    });
    return z.NEVER;
  }
  return f;
});

// ─── Schema ───────────────────────────────────────────────────────────────
// El orden de los campos importa: si varios campos fallan, Zod reporta los
// issues en orden de declaración, y devolvemos `issues[0]` al wrapper. Mantén
// este orden alineado con la secuencia de chequeos del validador previo para
// que los tests que matchean por nombre de campo sigan pasando.

const creditProductInputSchema = z.object({
  providerName: z.unknown().transform((v, ctx) => {
    const s = str(v, MAX_NAME);
    if (!s) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'providerName is required.' });
      return z.NEVER;
    }
    return s;
  }),
  providerType: enumOneOf(VALID_PROVIDER_TYPES, 'providerType'),
  tipo: enumOneOf(VALID_TIPOS, 'tipo'),
  esquemaAmortizacion: enumOneOf(VALID_ESQUEMAS, 'esquemaAmortizacion'),
  moneda: z.unknown().transform((v) => (VALID_MONEDAS.has(v) ? v : 'USD')),
  monedaMin: moneyAmountField('monedaMin'),
  monedaMax: moneyAmountField('monedaMax'),
  plazoMesesMin: plazoField('plazoMesesMin'),
  plazoMesesMax: plazoField('plazoMesesMax'),
  aprMin: aprField('aprMin'),
  aprMax: aprField('aprMax'),
  requisitos: requisitosField,
  fuente: fuenteField,
  activo: z.unknown().transform((v) => v !== false),
  descripcion: z.unknown().transform((v) => str(v, MAX_DESCRIPCION) || null),
});

// ─── Wrapper ──────────────────────────────────────────────────────────────

function buildCreditProductDoc(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Body is required.' };
  }

  const parsed = creditProductInputSchema.safeParse(body);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const v = parsed.data;

  // Cross-field rules — Zod no encaja naturalmente con "min ≤ max" porque cada
  // campo se valida en aislamiento. Aplicamos en el orden histórico para
  // preservar los mensajes que esperan los tests.
  if (v.monedaMin > v.monedaMax) {
    return { error: 'monedaMin cannot exceed monedaMax.' };
  }
  if (v.plazoMesesMin > v.plazoMesesMax) {
    return { error: 'plazoMesesMin cannot exceed plazoMesesMax.' };
  }
  if (!Number.isInteger(v.plazoMesesMin) || !Number.isInteger(v.plazoMesesMax)) {
    return { error: 'plazo bounds must be integers (months).' };
  }
  if (v.aprMin > v.aprMax) {
    return { error: 'aprMin cannot exceed aprMax.' };
  }

  return {
    data: {
      providerName: v.providerName,
      providerType: v.providerType,
      tipo: v.tipo,
      esquemaAmortizacion: v.esquemaAmortizacion,
      moneda: v.moneda,
      monedaMin: v.monedaMin,
      monedaMax: v.monedaMax,
      plazoMesesMin: v.plazoMesesMin,
      plazoMesesMax: v.plazoMesesMax,
      aprMin: v.aprMin,
      aprMax: v.aprMax,
      requisitos: v.requisitos,
      fuente: v.fuente,
      activo: v.activo,
      descripcion: v.descripcion,
    },
  };
}

module.exports = {
  buildCreditProductDoc,
  creditProductInputSchema,
  VALID_TIPOS,
  VALID_PROVIDER_TYPES,
  VALID_ESQUEMAS,
  VALID_MONEDAS,
  VALID_REQ_TIPOS,
  // Internos exportados para tests directos.
  _internals: { normalizeRequisito },
  _limits: { MAX_APR, MIN_PLAZO, MAX_PLAZO, MAX_MONEDA, MAX_REQUISITOS },
};
