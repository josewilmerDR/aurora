// Formatters de moneda para el módulo finance.
// Moneda funcional del sistema: CRC (Costa Rica). Formato es-CR: "1.234,56".
//
// Uso:
//   formatMoney(1234.5)             → "CRC 1.234,50"
//   formatMoney(1234.5, 'USD')      → "USD 1.234,50"
//   formatMoney(null)               → "—"
//   formatNumber(1234.5)            → "1.234,50"
//   formatNumber(1234.5, { decimals: 0 }) → "1.235"

const DEFAULT_CURRENCY = 'CRC';
const DEFAULT_LOCALE = 'es-CR';

export function formatMoney(n, currency = DEFAULT_CURRENCY, { locale = DEFAULT_LOCALE, decimals = 2 } = {}) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${currency} ${v.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatNumber(n, { locale = DEFAULT_LOCALE, decimals = 2 } = {}) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Precio unitario: 2 decimales mínimo, hasta 4 si los necesita. Evita el ruido
// de "100,0000" para precios redondos sin perder precisión en precios finos.
export function formatPrice(n, { locale = DEFAULT_LOCALE } = {}) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export { DEFAULT_CURRENCY, DEFAULT_LOCALE };
