// Validación pura del payload de `cash_balance`. Sin Firestore.

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SOURCES = new Set(['manual', 'bank']);
const VALID_CURRENCIES = new Set(['USD', 'CRC']);

const MAX_NOTE = 500;
const MAX_AMOUNT = 1e12;
const MAX_FX = 100000;

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
  const currency = VALID_CURRENCIES.has(body.currency) ? body.currency : 'CRC';
  const source = VALID_SOURCES.has(body.source) ? body.source : 'manual';

  // Moneda funcional = CRC. Si la transacción es en otra moneda, exigimos
  // tipo de cambio y congelamos el equivalente en CRC en `amountCRC` para
  // que los reportes históricos no cambien cuando el FX se mueva.
  let exchangeRateToCRC = 1;
  if (currency !== 'CRC') {
    const fx = numberInRange(body.exchangeRateToCRC, 0.0001, MAX_FX);
    if (fx === null) {
      return { error: 'exchangeRateToCRC is required and must be > 0 when currency is not CRC.' };
    }
    exchangeRateToCRC = fx;
  }
  const amountCRC = Math.round(amount * exchangeRateToCRC * 100) / 100;

  return {
    data: {
      dateAsOf: body.dateAsOf,
      amount,
      currency,
      exchangeRateToCRC,
      amountCRC,
      source,
      note: str(body.note, MAX_NOTE),
    },
  };
}

module.exports = {
  buildCashBalanceDoc,
  isValidISODate,
};
