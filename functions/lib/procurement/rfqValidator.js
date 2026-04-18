// Pure validator for RFQ (Request for Quotation) bodies.
//
// Returns { data } on success or { error } with a user-facing message on
// failure. Mirror of patterns used in routes/buyers/validator.js.

const MAX_NOTE = 500;
const MAX_NAME = 200;
const MAX_SUPPLIERS = 20;

function buildRfqDoc(body = {}) {
  const productoId = str(body.productoId, 80);
  if (!productoId) return { error: 'productoId is required.' };

  const cantidad = num(body.cantidad);
  if (!(cantidad > 0)) return { error: 'cantidad must be greater than zero.' };

  const unidad = str(body.unidad, 20);
  if (!unidad) return { error: 'unidad is required.' };

  const deadline = str(body.deadline, 10);
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return { error: 'deadline must be a valid YYYY-MM-DD date.' };
  }
  if (!isFutureOrToday(deadline)) {
    return { error: 'deadline cannot be in the past.' };
  }

  const supplierIds = Array.isArray(body.supplierIds)
    ? body.supplierIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim())
    : [];
  if (supplierIds.length === 0) return { error: 'At least one supplierId is required.' };
  if (supplierIds.length > MAX_SUPPLIERS) {
    return { error: `At most ${MAX_SUPPLIERS} suppliers per RFQ.` };
  }

  return {
    data: {
      productoId,
      nombreComercial: str(body.nombreComercial, MAX_NAME),
      cantidad,
      unidad,
      deadline,
      supplierIds,
      notas: str(body.notas, MAX_NOTE),
      currency: str(body.currency, 10) || 'USD',
      maxLeadTimeDays: optionalPositiveInt(body.maxLeadTimeDays),
    },
  };
}

function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function optionalPositiveInt(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function isFutureOrToday(ymd) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(ymd + 'T00:00:00Z');
  return target.getTime() >= today.getTime();
}

module.exports = {
  buildRfqDoc,
  MAX_NOTE,
  MAX_SUPPLIERS,
};
