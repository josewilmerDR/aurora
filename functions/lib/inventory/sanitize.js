// Sanitizadores de entrada compartidos por los flujos de ingreso de stock
// (products/intake.js, procurement-invoices/receipts.js). Antes estaban
// duplicados literalmente en ambos archivos.
//
// `cleanStr` quita chars de control + bidi-override de strings user-controlled
// antes de persistir y recorta a `max`. La RegExp se construye por códigos para
// no incrustar chars crudos en el fuente. `num` acota numéricos a [min, max]
// descartando NaN/Infinity/negativos.

const CONTROL_BIDI = new RegExp(
  '[' +
  '\\u0000-\\u001F\\u007F-\\u009F' +                 // C0 + C1 control
  '\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069' +  // zero-width + bidi overrides
  ']',
  'g',
);

const cleanStr = (v, max) =>
  (typeof v === 'string' ? v : '').replace(CONTROL_BIDI, '').slice(0, max);

const num = (v, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = parseFloat(v);
  if (!isFinite(n)) return 0;
  return Math.min(Math.max(n, min), max);
};

module.exports = { cleanStr, num };
