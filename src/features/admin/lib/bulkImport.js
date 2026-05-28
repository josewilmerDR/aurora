// ─────────────────────────────────────────────────────────────────────────────
// bulkImport — helpers puros de la carga masiva de Configuración inicial.
//
// Vive fuera de la página (InitialSetup.jsx) para que sea testeable y no
// engorde el componente: parseo de Excel, normalizaciones, fechas y un fetch
// JSON tolerante. Nada de React acá.
// ─────────────────────────────────────────────────────────────────────────────
import * as XLSX from 'xlsx';

// ── Guardrails de import ──────────────────────────────────────────────────────
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ROWS       = 5000;

// Lee y parsea un archivo Excel con validaciones. Devuelve filas o lanza Error con msg legible.
export async function readExcelRows(file) {
  if (!file) throw new Error('No se seleccionó archivo.');
  if (file.size > MAX_FILE_BYTES) throw new Error(`Archivo demasiado grande (máx. ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
  const workbook = XLSX.read(await file.arrayBuffer());
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('El archivo no contiene hojas.');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  if (rows.length > MAX_ROWS) throw new Error(`Demasiadas filas (máx. ${MAX_ROWS}).`);
  return rows;
}

// Genera y descarga una plantilla .xlsx (encabezados + fila de ejemplo).
export function downloadTemplate({ headers, sampleRow, sheetName, fileName, colWidth = 22 }) {
  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  ws['!cols'] = headers.map(() => ({ wch: colWidth }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

// ── Normalización de tipo de producto ────────────────────────────────────────
export const TIPOS_PRODUCTO = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];
export const normalizeTipo = (val) => {
  const s = String(val || '').trim();
  return TIPOS_PRODUCTO.find(t => t.toLowerCase() === s.toLowerCase()) ?? s;
};

// Quita acentos/diacríticos para comparar contra catálogos sin acentos.
// NFD separa la letra de su acento; \p{M} (marcas combinantes, flag u) borra
// el acento. Property-escape en vez de un rango literal frágil de codepoints.
const stripDiacritics = (val) =>
  String(val || '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

// ── Normalización rol de usuario ─────────────────────────────────────────────
export const ROLES_VALIDOS = ['trabajador', 'encargado', 'supervisor', 'rrhh', 'administrador'];
export const normalizeRol = (val) => {
  const s = stripDiacritics(val);
  return ROLES_VALIDOS.find(r => r === s) ?? 'trabajador';
};

// ── Normalización proveedor ───────────────────────────────────────────────────
export const CATEGORIAS_PROV = ['agroquimicos', 'fertilizantes', 'maquinaria', 'servicios', 'combustible', 'semillas', 'otros'];
export const normalizeCategoriaProv = (val) => {
  const s = stripDiacritics(val);
  return CATEGORIAS_PROV.find(c => c === s) ?? '';
};
export const normalizeTipoPago = (val) => (stripDiacritics(val) === 'credito' ? 'credito' : 'contado');

// ── Fechas ────────────────────────────────────────────────────────────────────
// Date → YYYY-MM-DD seguro ante RangeError de .toISOString().
export function dateToIsoDay(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  try { return d.toISOString().slice(0, 10); } catch { return null; }
}

// Firestore Timestamp JSON → YYYY-MM-DD.
export function timestampToDateStr(ts) {
  if (!ts) return null;
  if (typeof ts === 'string') return ts.slice(0, 10);
  const secs = ts.seconds ?? ts._seconds;
  return secs != null ? dateToIsoDay(new Date(secs * 1000)) : null;
}

// Cualquier valor de fecha de Excel → YYYY-MM-DD o null.
// xlsx puede devolver: JS Date, número serial Excel, o string.
export function toDateStr(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) return dateToIsoDay(val);
  if (typeof val === 'number') {
    // Número serial Excel: 1 = 1 ene 1900; ajuste de los 25569 días al epoch Unix
    return dateToIsoDay(new Date((val - 25569) * 86400 * 1000));
  }
  const s = String(val).trim();
  if (!s) return null;
  return dateToIsoDay(new Date(s));
}

// ── Fetch JSON tolerante (cualquier fallo → fallback) ────────────────────────
export async function fetchJsonSafe(apiFetch, path, fallback) {
  try {
    const res = await apiFetch(path);
    if (!res.ok) return fallback;
    return await res.json();
  } catch { return fallback; }
}
