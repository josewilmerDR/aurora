// Helpers puros de Unidades de Medida. Sin React ni fetch — testeables en
// aislamiento (ver __tests__/units.test.js). Extraídos de la página para que
// la lógica de formato/orden/validación no viva embebida en el componente.

const CURRENCY = '₡';

// Formatea un precio en colones (₡) con 2 decimales. Devuelve null para
// vacío/no-numérico para que el caller decida si mostrar el chip o no.
export function formatPrecio(val) {
  if (val == null || val === '') return null;
  const n = Number(val);
  if (Number.isNaN(n)) return null;
  return CURRENCY + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// i18n-safe: quita acentos y baja a lowercase. "hectárea" matchea "hectarea".
export function normalizeText(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// ¿El form tiene contenido tipeado? Decide si pedir confirmación al descartar
// y si persistir el borrador del alta.
export function isDirtyForm(f) {
  return !!(
    f.nombre.trim() ||
    f.descripcion.trim() ||
    String(f.precio).trim() ||
    f.labor ||
    String(f.factorConversion).trim() ||
    f.unidadBase.trim()
  );
}

// Orden alfabético por nombre, alineado con el GET del backend (orderBy nombre).
export function sortUnitsByNombre(list) {
  return list.slice().sort((a, b) =>
    (a.nombre || '').localeCompare(b.nombre || '', undefined, { numeric: true, sensitivity: 'base' })
  );
}

// Inserta o actualiza un doc en la lista local (update optimista) y reordena.
export function upsertUnit(list, doc) {
  const idx = list.findIndex(x => x.id === doc.id);
  const next = idx === -1 ? [...list, doc] : list.map(x => (x.id === doc.id ? { ...x, ...doc } : x));
  return sortUnitsByNombre(next);
}

// XOR: una conversión necesita factor Y unidad base juntos. Recibe los valores
// crudos del form (strings). true = sólo uno está completo → inválido.
export function conversionIncomplete(factorStr, baseStr) {
  return (String(factorStr).trim() !== '') !== (String(baseStr).trim() !== '');
}
