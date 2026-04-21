// Validación pura del payload de `cash_balance`. Sin Firestore.

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SOURCES = new Set(['manual', 'bank']);
const VALID_CURRENCIES = new Set(['USD', 'CRC']);

const MAX_NOTE = 500;
const MAX_AMOUNT = 1e12;

function isValidISODate(s) {
  if (typeof s !== 'string' || !FECHA_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function numberInRange(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function buildCashBalanceDoc(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body is required.' };
  }
  if (!isValidISODate(body.dateAsOf)) {
    return { error: 'dateAsOf must be YYYY-MM-DD.' };
  }
  // El saldo puede ser negativo (sobregiro), por eso aceptamos valores < 0.
  const amount = numberInRange(body.amount, -MAX_AMOUNT, MAX_AMOUNT);
  if (amount === null) {
    return { error: 'Amount must be a finite number.' };
  }
  const currency = VALID_CURRENCIES.has(body.currency) ? body.currency : 'USD';
  const source = VALID_SOURCES.has(body.source) ? body.source : 'manual';

  return {
    data: {
      dateAsOf: body.dateAsOf,
      amount,
      currency,
      source,
      note: str(body.note, MAX_NOTE),
    },
  };
}

module.exports = {
  buildCashBalanceDoc,
  isValidISODate,
};
