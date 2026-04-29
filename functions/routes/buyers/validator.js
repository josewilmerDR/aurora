// Validación de payloads de `buyers` con Zod. Sin Firestore, sin side effects.
//
// Buyers tolera entradas inválidas en campos accesorios (paymentType, currency,
// status, creditDays, creditLimit) y los normaliza a un default razonable. Sólo
// `name` y `email` mal-formado producen un hard error — el resto se cae a un
// valor por defecto silenciosamente.

const { z } = require('zod');

const VALID_PAYMENT_TYPES = new Set(['contado', 'credito']);
const VALID_CURRENCIES = new Set(['USD', 'CRC']);
const VALID_STATUSES = new Set(['activo', 'inactivo']);

const MAX_NAME = 150;
const MAX_TEXT = 200;
const MAX_ADDRESS = 300;
const MAX_URL = 300;
const MAX_PHONE = 30;
const MAX_TAX_ID = 50;
const MAX_NOTES = 2000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Reusable Zod fragments ───────────────────────────────────────────────

const trimmedString = (max) =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, max) : ''), z.string());

const enumWithDefault = (validSet, fallback) =>
  z.unknown().transform((v) => (validSet.has(v) ? v : fallback));

// Versiones "soft" — devuelven null si el valor está fuera de rango o no es
// numérico, para que el wrapper decida qué hacer con el null. Así preservamos
// el comportamiento del validador anterior (creditDays out-of-range cae al
// default 30, creditLimit fuera de rango se persiste como null).
const intInRangeOrNull = (min, max) =>
  z.unknown().transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return n;
  });

const floatInRangeOrNull = (min, max) =>
  z.unknown().transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return n;
  });

// ─── Schema ───────────────────────────────────────────────────────────────

const buyerInputSchema = z.object({
  name: trimmedString(MAX_NAME),
  taxId: trimmedString(MAX_TAX_ID),
  phone: trimmedString(MAX_PHONE),
  email: trimmedString(MAX_TEXT),
  address: trimmedString(MAX_ADDRESS),
  paymentType: enumWithDefault(VALID_PAYMENT_TYPES, 'contado'),
  creditDays: intInRangeOrNull(1, 365),
  currency: enumWithDefault(VALID_CURRENCIES, 'USD'),
  contact: trimmedString(MAX_TEXT),
  whatsapp: trimmedString(MAX_PHONE),
  website: trimmedString(MAX_URL),
  country: trimmedString(MAX_TEXT),
  creditLimit: floatInRangeOrNull(0, 1e12),
  notes: trimmedString(MAX_NOTES),
  status: enumWithDefault(VALID_STATUSES, 'activo'),
});

// ─── Wrapper ──────────────────────────────────────────────────────────────

function buildBuyerDoc(body) {
  // Toda la schema usa fallbacks suaves, así que safeParse no debería fallar
  // jamás. Mantenemos el chequeo defensivo por si alguien añade un campo con
  // refine() más adelante.
  const parsed = buyerInputSchema.safeParse(body || {});
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const v = parsed.data;

  if (!v.name) return { error: 'Buyer name is required.' };
  if (v.email && !EMAIL_RE.test(v.email)) return { error: 'Invalid email address.' };

  // creditDays sólo aplica a paymentType='credito'. Cuando el usuario eligió
  // crédito pero no mandó días (o mandó algo inválido), default a 30.
  const creditDays = v.paymentType === 'credito' ? (v.creditDays ?? 30) : null;

  return {
    data: {
      name: v.name,
      taxId: v.taxId,
      phone: v.phone,
      email: v.email,
      address: v.address,
      paymentType: v.paymentType,
      creditDays,
      currency: v.currency,
      contact: v.contact,
      whatsapp: v.whatsapp,
      website: v.website,
      country: v.country,
      creditLimit: v.creditLimit,
      notes: v.notes,
      status: v.status,
    },
  };
}

module.exports = {
  buildBuyerDoc,
  buyerInputSchema,
  VALID_PAYMENT_TYPES,
  VALID_CURRENCIES,
  VALID_STATUSES,
};
