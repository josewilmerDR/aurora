// Formateo compartido del módulo financiero. Antes cada widget del dashboard
// duplicaba su propio `fmt` y sus helpers de mes; eso hacía que el bug de
// fecha (corrimiento de un día) y la falta de moneda divergieran archivo por
// archivo. Una sola fuente de verdad acá los arregla de una vez.

// Moneda funcional del sistema. Budgets y costos se normalizan a CRC en el
// backend (ver functions/routes/budgets/validator.js), así que los widgets de
// Presupuesto y Rentabilidad muestran montos en CRC. Tesorería/Caja usan en
// cambio la moneda del saldo registrado (puede ser USD), que viene en el
// response — por eso ese caso pasa `currency` explícito.
export const FUNCTIONAL_CURRENCY = 'CRC';

// Locale único para todos los montos del módulo. Centralizado a propósito:
// antes convivían 'en-US' (números) con 'es-ES'/'es-CR' (fechas) en distintos
// widgets. Mantenemos el agrupado en-US (coma de miles, punto decimal), común
// en contexto USD/negocio, pero ahora en un solo lugar.
const MONEY_LOCALE = 'en-US';

/**
 * Formatea un monto entero con separador de miles y, opcionalmente, prefijo
 * de moneda. Devuelve '—' para valores no finitos.
 *   formatMoney(1234)         → "1,234"
 *   formatMoney(1234, 'USD')  → "USD 1,234"
 */
export function formatMoney(n, currency) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const num = v.toLocaleString(MONEY_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return currency ? `${currency} ${num}` : num;
}

/**
 * Formatea un porcentaje con un decimal. Devuelve '—' para null/undefined.
 *   formatPct(12.34) → "12.3%"
 */
export function formatPct(n) {
  return n == null ? '—' : `${Number(n).toFixed(1)}%`;
}

/**
 * "2026-04-22" → "22 abr". Parsea como fecha LOCAL para evitar el corrimiento
 * de un día en zonas al oeste de UTC: `new Date('2026-04-22')` se interpreta
 * como medianoche UTC, que en CR (UTC-6) cae el día anterior por la tarde.
 */
export function formatDateShort(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

/** Período del mes actual en formato "YYYY-MM" (lo que consume budgets). */
export function currentMonthPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Rango del mes actual: del día 1 hasta hoy, ambos "YYYY-MM-DD". */
export function currentMonthRange() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const today = d.toISOString().slice(0, 10);
  return { desde: `${y}-${m}-01`, hasta: today };
}

/** Etiqueta del mes actual capitalizada: "Mayo 2026". */
export function currentMonthLabel() {
  const raw = new Date().toLocaleDateString('es-CR', {
    month: 'long',
    year: 'numeric',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
