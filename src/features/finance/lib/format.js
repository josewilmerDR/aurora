// Formateo compartido del módulo financiero.
//
// Antes este archivo tenía su PROPIO formatMoney (locale en-US, 0 decimales) y
// formatDateShort (es-ES, sin año), que divergían del resto del dominio: el
// dashboard mostraba "1,234" / "22 abr" y las páginas a las que enlazaba
// mostraban "CRC 1.234,50" / "22 abr 26" para el MISMO dato. Eliminados a favor
// de la única fuente de verdad (lib/formatMoney + lib/formatDate). Este archivo
// ahora solo reexporta esos formateadores y conserva los helpers de período,
// que sí son específicos del módulo. Las fechas se importan directo de
// lib/formatDate en todos lados, así que acá no se reexportan.

export {
  formatMoney,
  formatNumber,
  formatPrice,
  formatPct,
  DEFAULT_CURRENCY,
  // Alias histórico: el módulo financiero llama "moneda funcional" a la moneda
  // por defecto del sistema (CRC). Un solo valor, dos nombres por compatibilidad.
  DEFAULT_CURRENCY as FUNCTIONAL_CURRENCY,
} from '../../../lib/formatMoney';

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
