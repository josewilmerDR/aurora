// Validación pura del payload de `income_records`.

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_COLLECTION_STATUSES = new Set(['pendiente', 'cobrado', 'anulado']);
const VALID_CURRENCIES = new Set(['USD', 'CRC']);

const MAX_NOTE = 500;
const MAX_NAME = 150;
const MAX_UNIT = 32;
const MAX_ID = 128;
const MAX_QUANTITY = 1e9;
const MAX_AMOUNT = 1e12;

// ISO estricto — rechaza "2026-02-30" que new Date() normaliza.
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

function buildIncomeDoc(body, { buyerName = '' } = {}) {
  if (!isValidISODate(body.date)) {
    return { error: 'Date is required in YYYY-MM-DD format.' };
  }

  const buyerId = str(body.buyerId, MAX_ID);
  if (!buyerId) return { error: 'Buyer is required.' };

  const quantity = numberInRange(body.quantity, 0, MAX_QUANTITY);
  if (quantity === null || quantity <= 0) {
    return { error: 'Quantity must be greater than 0.' };
  }

  const unitPrice = numberInRange(body.unitPrice, 0, MAX_AMOUNT);
  if (unitPrice === null) return { error: 'Unit price is required and must be ≥ 0.' };

  // Si el cliente envía totalAmount, lo respetamos (descuentos); si no, lo
  // calculamos. Límite defensivo para evitar overflow.
  const providedTotal = numberInRange(body.totalAmount, 0, MAX_AMOUNT);
  const totalAmount = providedTotal !== null ? providedTotal : quantity * unitPrice;
  if (!Number.isFinite(totalAmount) || totalAmount > MAX_AMOUNT) {
    return { error: 'Total amount out of range.' };
  }

  const currency = VALID_CURRENCIES.has(body.currency) ? body.currency : 'USD';
  const collectionStatus = VALID_COLLECTION_STATUSES.has(body.collectionStatus)
    ? body.collectionStatus
    : 'pendiente';

  const expectedCollectionDate = body.expectedCollectionDate
    ? (isValidISODate(body.expectedCollectionDate) ? body.expectedCollectionDate : null)
    : null;
  if (body.expectedCollectionDate && expectedCollectionDate === null) {
    return { error: 'Expected collection date must be YYYY-MM-DD.' };
  }

  const actualCollectionDate = body.actualCollectionDate
    ? (isValidISODate(body.actualCollectionDate) ? body.actualCollectionDate : null)
    : null;
  if (body.actualCollectionDate && actualCollectionDate === null) {
    return { error: 'Actual collection date must be YYYY-MM-DD.' };
  }
  if (collectionStatus === 'cobrado' && !actualCollectionDate) {
    return { error: 'Actual collection date is required when status is "cobrado".' };
  }

  return {
    data: {
      date: body.date,
      loteId: str(body.loteId, MAX_ID) || null,
      loteNombre: str(body.loteNombre, MAX_NAME) || null,
      grupo: str(body.grupo, MAX_NAME) || null,
      cosechaRegistroId: str(body.cosechaRegistroId, MAX_ID) || null,
      despachoId: str(body.despachoId, MAX_ID) || null,
      buyerId,
      buyerName: str(buyerName, MAX_NAME),
      quantity,
      unit: str(body.unit, MAX_UNIT),
      unitPrice,
      totalAmount,
      currency,
      collectionStatus,
      expectedCollectionDate,
      actualCollectionDate,
      note: str(body.note, MAX_NOTE),
    },
  };
}

module.exports = {
  buildIncomeDoc,
  isValidISODate,
  VALID_COLLECTION_STATUSES,
  VALID_CURRENCIES,
};
