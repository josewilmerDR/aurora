// Validación pura del payload de `budgets`. Sin Firestore.

const { BUDGET_CATEGORY_SET } = require('../../lib/finance/categories');
const { isValidPeriod } = require('../../lib/finance/periodRange');

const VALID_CURRENCIES = new Set(['USD', 'CRC']);

const MAX_NOTES = 1000;
const MAX_NAME = 150;
const MAX_ID = 128;
const MAX_AMOUNT = 1e12;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function numberInRange(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function buildBudgetDoc(body) {
  if (!isValidPeriod(body.period)) {
    return { error: 'Period must be YYYY, YYYY-Qn, or YYYY-MM.' };
  }

  const category = str(body.category, 64);
  if (!BUDGET_CATEGORY_SET.has(category)) {
    return { error: 'Category is not valid.' };
  }

  const assignedAmount = numberInRange(body.assignedAmount, 0, MAX_AMOUNT);
  if (assignedAmount === null || assignedAmount < 0) {
    return { error: 'Assigned amount must be a non-negative number.' };
  }

  const currency = VALID_CURRENCIES.has(body.currency) ? body.currency : 'CRC';

  // Moneda funcional = CRC. Exigimos FX cuando el presupuesto está en otra
  // moneda y congelamos el equivalente en `assignedAmountCRC`.
  let exchangeRateToCRC = 1;
  if (currency !== 'CRC') {
    const fx = numberInRange(body.exchangeRateToCRC, 0.0001, 100000);
    if (fx === null) {
      return { error: 'exchangeRateToCRC is required and must be > 0 when currency is not CRC.' };
    }
    exchangeRateToCRC = fx;
  }
  const assignedAmountCRC = Math.round(assignedAmount * exchangeRateToCRC * 100) / 100;

  return {
    data: {
      period: body.period,
      category,
      subcategory: str(body.subcategory, MAX_NAME) || null,
      loteId: str(body.loteId, MAX_ID) || null,
      grupoId: str(body.grupoId, MAX_ID) || null,
      assignedAmount,
      currency,
      exchangeRateToCRC,
      assignedAmountCRC,
      notes: str(body.notes, MAX_NOTES),
    },
  };
}

module.exports = {
  buildBudgetDoc,
  VALID_CURRENCIES,
};
