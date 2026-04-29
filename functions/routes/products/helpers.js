// Products — validators + constantes compartidas.
//
// Sub-archivo del split de routes/products.js. Las constantes y el validator
// `validateProducto` los consume crud.js (POST/PUT). Otros sub-archivos
// (ai, adjustment, intake) tienen sus propios límites locales y no
// dependen de este validator.

const PRODUCT_FIELDS = ['idProducto', 'nombreComercial', 'ingredienteActivo', 'tipo',
  'plagaQueControla', 'periodoReingreso', 'periodoACosecha', 'cantidadPorHa',
  'unidad', 'stockActual', 'stockMinimo', 'moneda', 'tipoCambio', 'precioUnitario',
  'iva', 'proveedor', 'registroFitosanitario', 'observacion', 'activo'];

const VALID_TYPES = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro', ''];
const VALID_CURRENCIES = ['USD', 'CRC', 'EUR'];

function validateProducto(body, isCreate) {
  const errors = [];
  const s = (v) => typeof v === 'string' ? v : '';
  const checkStr = (key, label, max) => {
    if (body[key] !== undefined && s(body[key]).length > max)
      errors.push(`${label}: max ${max} characters`);
  };
  const checkNumRange = (key, label, min, max, exclusive) => {
    if (body[key] === undefined || body[key] === '' || body[key] === null) return;
    const n = Number(body[key]);
    if (isNaN(n)) { errors.push(`${label}: must be a number`); return; }
    if (n < min) errors.push(`${label}: min ${min}`);
    if (exclusive ? n >= max : n > max) errors.push(`${label}: must be less than ${max}`);
  };

  if (isCreate && !s(body.nombreComercial).trim())
    errors.push('nombreComercial is required');

  checkStr('idProducto',            'idProducto',           32);
  checkStr('nombreComercial',       'nombreComercial',     64);
  checkStr('ingredienteActivo',     'ingredienteActivo',   64);
  checkStr('proveedor',             'proveedor',           128);
  checkStr('registroFitosanitario', 'registroFitosanitario', 32);
  checkStr('observacion',           'observacion',         288);
  checkStr('plagaQueControla',      'plagaQueControla',    128);
  checkStr('unidad',                'unidad',              40);

  if (body.tipo !== undefined && !VALID_TYPES.includes(s(body.tipo)))
    errors.push('Invalid tipo');
  if (body.moneda !== undefined && !VALID_CURRENCIES.includes(s(body.moneda)))
    errors.push('Invalid moneda');

  checkNumRange('cantidadPorHa',    'cantidadPorHa',      0, 2048, true);
  checkNumRange('periodoReingreso', 'periodoReingreso',    0, 512,  true);
  checkNumRange('periodoACosecha',  'periodoACosecha',     0, 512,  true);
  checkNumRange('stockActual',      'stockActual',         0, 32768, true);
  checkNumRange('stockMinimo',      'stockMinimo',         0, 32768, true);
  checkNumRange('precioUnitario',   'precioUnitario',      0, 2097152, true);
  checkNumRange('tipoCambio',       'tipoCambio',          0, 2097152, true);
  checkNumRange('iva',              'iva',                 0, 100,  false);

  return errors;
}

module.exports = {
  PRODUCT_FIELDS,
  VALID_TYPES,
  VALID_CURRENCIES,
  validateProducto,
};
