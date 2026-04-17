// Validación pura del payload de `buyers` — sin Firestore, sin side effects.

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

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const intInRange = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

const floatInRange = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

function buildBuyerDoc(body) {
  const name = str(body.name, MAX_NAME);
  if (!name) return { error: 'Buyer name is required.' };

  const email = str(body.email, MAX_TEXT);
  if (email && !EMAIL_RE.test(email)) return { error: 'Invalid email address.' };

  const paymentType = VALID_PAYMENT_TYPES.has(body.paymentType) ? body.paymentType : 'contado';
  const currency = VALID_CURRENCIES.has(body.currency) ? body.currency : 'USD';
  const status = VALID_STATUSES.has(body.status) ? body.status : 'activo';

  return {
    data: {
      name,
      taxId: str(body.taxId, MAX_TAX_ID),
      phone: str(body.phone, MAX_PHONE),
      email,
      address: str(body.address, MAX_ADDRESS),
      paymentType,
      creditDays: paymentType === 'credito' ? (intInRange(body.creditDays, 1, 365) ?? 30) : null,
      currency,
      contact: str(body.contact, MAX_TEXT),
      whatsapp: str(body.whatsapp, MAX_PHONE),
      website: str(body.website, MAX_URL),
      country: str(body.country, MAX_TEXT),
      creditLimit: floatInRange(body.creditLimit, 0, 1e12),
      notes: str(body.notes, MAX_NOTES),
      status,
    },
  };
}

module.exports = {
  buildBuyerDoc,
  VALID_PAYMENT_TYPES,
  VALID_CURRENCIES,
  VALID_STATUSES,
};
