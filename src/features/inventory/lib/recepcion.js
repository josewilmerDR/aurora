// Helpers puros del flujo de Recepción de Mercancía. Sin React: cálculos de
// línea, fila vacía y formato de fecha. Mantener la página fina (CLAUDE.md).

let _uid = Date.now();

// Fila vacía de la grilla. `cantidadOC` guarda la cantidad ordenada cuando la
// fila viene de una OC (para conciliación backend); en captura manual queda ''.
export const newRow = () => ({
  _key: ++_uid,
  idProducto: '',
  nombreComercial: '',
  unidad: 'L',
  cantidad: '',
  total: '',
  iva: 0,
  cantidadOC: '',
});

// Genera un _key único para filas creadas fuera de newRow (scan, OC).
export const nextRowKey = () => ++_uid;

export function calcPrecioUnit(f) {
  const cant = parseFloat(f.cantidad) || 0;
  const tot  = parseFloat(f.total)    || 0;
  return cant > 0 ? tot / cant : 0;
}

export function calcIvaAmount(f) {
  const tot = parseFloat(f.total) || 0;
  return tot * (f.iva / 100);
}

// Fechas date-only (YYYY-MM-DD) del backend: se formatean en UTC a propósito.
// `new Date('2026-06-04')` parsea a medianoche UTC; mostrar en zona local (CR
// UTC-6) restaría un día. UTC mantiene el día que el usuario espera.
export const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

// Variante con mes largo para vistas de detalle. Mismo criterio UTC (date-only).
export const formatDateLong = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

// Fecha + hora para timestamps con hora real (createdAt, anuladaAt). Estos SÍ
// son instantes, no date-only, así que van en zona local del usuario.
export const formatDateTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const formatMoney = (n) =>
  Number(n || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Short id legible de una recepción: REC-XXXXXX.
export const recepcionShortId = (id) => `REC-${(id || '').slice(-6).toUpperCase()}`;
