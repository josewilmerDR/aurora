// Helpers compartidos del dominio fields/. Hoy son consumidos por
// LoteManagement y LoteFormModal; la suite de sort (compare/multiSort) está
// pensada para reuso futuro desde GrupoManagement, que tiene una tabla de
// bloques con el mismo modelo de ordenamiento.

// Los timestamps de Firestore llegan al frontend como { _seconds,
// _nanoseconds }. Otras callsites pasan strings ISO, milisegundos o Date.
// Resolvemos a Date una sola vez acá para que los formatters no repitan
// la heurística.
const toDate = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp._seconds) return new Date(timestamp._seconds * 1000);
  return new Date(timestamp);
};

// Fecha corta UTC para listas, badges y tarjetas (e.g. "23 may 2026").
// UTC porque las fechas de creación de lotes son "del día calendario"
// (sin hora) y no queremos que un usuario en GMT-6 vea un lote creado
// el día anterior solo porque el servidor guardó medianoche UTC.
export function formatDate(timestamp) {
  const d = toDate(timestamp);
  if (!d) return '—';
  return d.toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

// Fecha larga para documentos imprimibles (e.g. "23 de mayo de 2026").
// Acepta Date directo o cualquier cosa que el constructor de Date pueda
// parsear. Si recibe un Firestore Timestamp, se convierte vía toDate.
export function formatDateLong(value) {
  if (!value) return '—';
  const d = toDate(value) ?? new Date(value);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
}

// YYYY-MM-DD en zona local para prellenar <input type="date">. El shift
// con getTimezoneOffset compensa que toISOString siempre devuelve UTC —
// sin el shift, un timestamp medianoche-UTC en GMT-6 aparecería como el
// día anterior en el picker.
export function formatDateForInput(timestamp) {
  const d = toDate(timestamp);
  if (!d) return '';
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset());
  return d.toISOString().split('T')[0];
}

// Comparador genérico case-insensitive con localeCompare es-ES. Si ambos
// valores son numéricos hace resta directa para mantener orden numérico
// real (no "10" antes que "2").
export function compare(a, b, field) {
  const av = a[field] ?? '';
  const bv = b[field] ?? '';
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
}

// Ordena por una lista priorizada de criterios { field, dir: 'asc' | 'desc' }.
// Recorre los criterios en orden hasta encontrar uno que rompa el empate.
// Filtra entradas sin field para que se pueda pasar el state crudo del
// componente sin sanitizarlo antes.
export function multiSort(records, sorts) {
  const active = sorts.filter(s => s.field);
  if (!active.length) return [...records];
  return [...records].sort((a, b) => {
    for (const s of active) {
      const r = compare(a, b, s.field);
      if (r !== 0) return s.dir === 'desc' ? -r : r;
    }
    return 0;
  });
}
