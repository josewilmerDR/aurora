// Helpers de fecha para UI. Centraliza el formateo corto de fechas que vivía
// duplicado e inconsistente en varias páginas (IncomeRecords anclaba a mediodía,
// DebtSimulations usaba `new Date(iso)` directo → desfase de un día en zonas
// UTC-negativas como CR).
//
// Uso:
//   formatShortDate('2026-05-31')               → "31 may 26"
//   formatShortDate('2026-05-31T00:00:00Z')     → "31 may 26" (sin desfase)
//   formatShortDate(null)                       → "—"

const DEFAULT_LOCALE = 'es-CR';

// Formatea a "DD mmm YY". Las fechas que llegan como `YYYY-MM-DD` (date-only) o
// medianoche UTC se anclan a mediodía local para que la conversión de zona no
// las corra al día anterior.
export function formatShortDate(iso, { locale = DEFAULT_LOCALE } = {}) {
  if (!iso) return '—';
  try {
    const s = String(iso);
    // date-only → anclamos a mediodía local; con hora → la respetamos.
    const d = s.length === 10 ? new Date(s + 'T12:00:00') : new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: '2-digit' });
  } catch {
    return String(iso);
  }
}
