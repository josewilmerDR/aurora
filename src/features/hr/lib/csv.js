// Utilidades CSV (RFC 4180) compartidas. Extraídas de FixedPayrollReport para
// que cualquier página que exporte tablas (planilla fija, unitaria, etc.) use
// el mismo escaping y la misma estrategia de BOM, sin duplicar la lógica.

// BOM (U+FEFF) explícito y nombrado. Va al inicio del archivo para que Excel
// autodetecte UTF-8 y los acentos no aparezcan rotos. Nombrado a propósito:
// un char invisible incrustado en un literal es frágil ante refactors/format.
export const CSV_BOM = '﻿';

// Cita campos con coma, comilla o salto de línea; escapa comillas duplicándolas.
export function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(cells) {
  return cells.map(csvEscape).join(',') + '\r\n';
}

// Construye el CSV completo (con BOM) y dispara la descarga en el browser.
// Centraliza la danza de Blob + <a> + revokeObjectURL.
export function downloadCsv(filename, rows) {
  const csv = rows.join('');
  const blob = new Blob([CSV_BOM, csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
