// Validación de payloads de `budgets` con Zod. Sin Firestore, sin side effects.
//
// Convención del estándar (docs/code-standards.md §3): un solo archivo de
// schemas por dominio, expone tanto la schema declarativa como un wrapper
// `buildXDoc(body)` que devuelve `{ data, error }` con mensajes en inglés.
// Los handlers en crud.js permanecen idénticos.

const { z } = require('zod');
const { BUDGET_CATEGORY_SET } = require('../../lib/finance/categories');
const { isValidPeriod } = require('../../lib/finance/periodRange');

const VALID_CURRENCIES = new Set(['USD', 'CRC']);

const MAX_NOTES = 1000;
const MAX_NAME = 150;
const MAX_ID = 128;
const MAX_AMOUNT = 1e12;
const FX_MIN = 0.0001;
const FX_MAX = 100000;

// ─── Reusable Zod fragments ───────────────────────────────────────────────

const trimmedString = (max) =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, max) : ''), z.string());

// Acepta cualquier valor numérico-ish; rechaza null/undefined/'' y strings no
// finitos. Reemplaza al `numberInRange` imperativo y produce el mismo mensaje.
const requiredNumberInRange = (min, max, message) =>
  z.unknown().transform((v, ctx) => {
    if (v === null || v === undefined || v === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return n;
  });

// ─── Schema ───────────────────────────────────────────────────────────────

const budgetInputSchema = z.object({
  // `period` se valida con la misma función pura que usa periodRange.js, para
  // que la regla viva en un solo lugar (categories.js + periodRange.js).
  period: z.unknown().refine(isValidPeriod, {
    message: 'Period must be YYYY, YYYY-Qn, or YYYY-MM.',
  }),
  category: trimmedString(64).refine((c) => BUDGET_CATEGORY_SET.has(c), {
    message: 'Category is not valid.',
  }),
  assignedAmount: requiredNumberInRange(0, MAX_AMOUNT, 'Assigned amount must be a non-negative number.'),
  // Soft fallback: monedas desconocidas no son error, se normalizan a CRC
  // (moneda funcional). Ver decisión en buildBudgetDoc().
  currency: z.unknown().transform((v) => (VALID_CURRENCIES.has(v) ? v : 'CRC')),
  subcategory: trimmedString(MAX_NAME),
  loteId: trimmedString(MAX_ID),
  grupoId: trimmedString(MAX_ID),
  notes: trimmedString(MAX_NOTES),
});

// ─── Wrapper ──────────────────────────────────────────────────────────────

function buildBudgetDoc(body) {
  const parsed = budgetInputSchema.safeParse(body || {});
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const v = parsed.data;

  // Cross-field rule: cuando el presupuesto NO está en CRC exigimos un fx
  // explícito y congelamos el equivalente en `assignedAmountCRC`. Vive en el
  // wrapper porque Zod no encaja bien con el "sólo requerido si X".
  let exchangeRateToCRC = 1;
  if (v.currency !== 'CRC') {
    const raw = body?.exchangeRateToCRC;
    if (raw === null || raw === undefined || raw === '') {
      return { error: 'exchangeRateToCRC is required and must be > 0 when currency is not CRC.' };
    }
    const fx = Number(raw);
    if (!Number.isFinite(fx) || fx < FX_MIN || fx > FX_MAX) {
      return { error: 'exchangeRateToCRC is required and must be > 0 when currency is not CRC.' };
    }
    exchangeRateToCRC = fx;
  }
  const assignedAmountCRC = Math.round(v.assignedAmount * exchangeRateToCRC * 100) / 100;

  return {
    data: {
      period: body.period,
      category: v.category,
      subcategory: v.subcategory || null,
      loteId: v.loteId || null,
      grupoId: v.grupoId || null,
      assignedAmount: v.assignedAmount,
      currency: v.currency,
      exchangeRateToCRC,
      assignedAmountCRC,
      notes: v.notes,
    },
  };
}

module.exports = {
  buildBudgetDoc,
  budgetInputSchema,
  VALID_CURRENCIES,
};
