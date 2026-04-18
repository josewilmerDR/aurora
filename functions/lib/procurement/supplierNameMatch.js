// Supplier identity utilities.
//
// Orders and receptions store the supplier as a free-text `proveedor` string,
// not a foreign key. To correlate history with a `proveedores` doc we match by
// normalized name (trim, lowercase, collapse whitespace, strip diacritics).

function normalizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Returns true when `candidate` matches `supplierName` (or any alias).
function matchesSupplier(candidate, supplierName, aliases = []) {
  const target = normalizeName(candidate);
  if (!target) return false;
  if (target === normalizeName(supplierName)) return true;
  for (const alias of aliases) {
    if (target === normalizeName(alias)) return true;
  }
  return false;
}

module.exports = {
  normalizeName,
  matchesSupplier,
};
