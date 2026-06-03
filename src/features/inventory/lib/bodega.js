// Helpers puros + constantes compartidas por BodegaView (combustibles y genérica).
// Todo lo que no depende de React vive acá para mantener los componentes finos.
import { FiBox, FiTool, FiTruck, FiDroplet, FiPackage } from 'react-icons/fi';

// ── Icon map ───────────────────────────────────────────────────────────────
export const ICON_MAP = { FiBox, FiTool, FiTruck, FiDroplet, FiPackage };

// Etiquetas legibles para el picker de íconos (fuente única; no redefinir el
// set de íconos en las páginas). El orden define el orden visual del picker.
export const ICON_LABELS = {
  FiBox:     'Caja',
  FiTool:    'Herramienta',
  FiTruck:   'Camión',
  FiDroplet: 'Líquido',
  FiPackage: 'Paquete',
};

// Array derivado para iterar en pickers: [{ key, Icon, label }].
export const ICON_OPTIONS = Object.keys(ICON_MAP).map(key => ({
  key,
  Icon: ICON_MAP[key],
  label: ICON_LABELS[key] || key,
}));

// ── Formateo ───────────────────────────────────────────────────────────────
// Locale unificado es-CR (la finca real) para números y fechas.
const LOCALE = 'es-CR';

export const fmt = (n) => (n ?? 0).toLocaleString(LOCALE, { maximumFractionDigits: 2 });

// Número + moneda inline (ej. "1.500 CRC"); evita lecturas ambiguas en tablas
// que mezclan USD/CRC. Si no hay moneda, cae a solo número.
export const fmtMoney = (n, moneda) => {
  if (n == null || n === '') return '—';
  return moneda ? `${fmt(n)} ${moneda}` : fmt(n);
};

export const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

// Costo promedio móvil = valor inventario / stock. El header lo rotula como
// "Costo prom. unit." para no confundirlo con un precio de lista.
export const avgUnitCost = (item) =>
  item.total != null && item.total !== '' && item.stockActual > 0
    ? item.total / item.stockActual
    : null;

// ── Formularios vacíos ─────────────────────────────────────────────────────
export const EMPTY_ITEM    = { nombre: '', unidad: '', stockActual: '', stockMinimo: '', descripcion: '', total: '', moneda: 'CRC' };
export const EMPTY_MOV     = { itemId: '', tipo: 'salida', cantidad: '', nota: '', loteId: '', laborId: '', activoId: '', operarioId: '' };
export const EMPTY_ENTRADA = { itemId: '', tipo: 'entrada', cantidad: '', factura: '', oc: '', total: '' };

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export const MONEDAS = ['USD', 'CRC', 'EUR'];

// Normaliza coma decimal antes de parseFloat (teclados es-CR usan coma).
// Reemplaza TODAS las comas: "1,5,0" no debe colarse como 1.5 silenciosamente.
export const parseDecimal = (value) => parseFloat(String(value ?? '').replace(/,/g, '.'));

// Número válido y finito ≥ 0 (acepta '' como "sin valor" → válido).
const isOptionalNonNeg = (value) => {
  if (value === '' || value === undefined || value === null) return true;
  const n = parseDecimal(value);
  return !isNaN(n) && isFinite(n) && n >= 0;
};

// ── Validadores puros (mismo contrato que el backend en warehouses.js) ──────
// Devuelven { field, message } con el PRIMER error, o null si todo OK. Vivir
// acá los hace testeables y evita que la validación derive entre los 3 forms.

export function validateItem(data) {
  if (!data.nombre?.trim()) return { field: 'nombre', message: 'El nombre es requerido.' };
  if (data.nombre.trim().length > 200) return { field: 'nombre', message: 'Nombre demasiado largo (máx 200).' };
  if (data.descripcion && data.descripcion.length > 500) return { field: 'descripcion', message: 'Descripción demasiado larga (máx 500).' };
  if (data.unidad && data.unidad.length > 50) return { field: 'unidad', message: 'Unidad demasiado larga (máx 50).' };
  if (!isOptionalNonNeg(data.stockActual)) return { field: 'stockActual', message: 'Stock actual debe ser un número ≥ 0.' };
  if (!isOptionalNonNeg(data.stockMinimo)) return { field: 'stockMinimo', message: 'Stock mínimo debe ser un número ≥ 0.' };
  if (!isOptionalNonNeg(data.total)) return { field: 'total', message: 'Total debe ser un número ≥ 0.' };
  return null;
}

export function validateEntrada(form) {
  const cant = parseDecimal(form.cantidad);
  if (!form.cantidad || isNaN(cant) || cant <= 0 || !isFinite(cant)) return { field: 'cantidad', message: 'La cantidad debe ser un número positivo.' };
  if (form.factura && form.factura.length > 100) return { field: 'factura', message: 'Factura demasiado larga (máx 100).' };
  if (form.oc && form.oc.length > 100) return { field: 'oc', message: 'OC demasiado larga (máx 100).' };
  if (!isOptionalNonNeg(form.total)) return { field: 'total', message: 'Total debe ser un número ≥ 0.' };
  return null;
}

export function validateSalida(form, { stockActual = 0, requireActivo = false } = {}) {
  const cant = parseDecimal(form.cantidad);
  if (!form.cantidad || isNaN(cant) || cant <= 0 || !isFinite(cant)) return { field: 'cantidad', message: 'La cantidad debe ser un número positivo.' };
  if (cant > (stockActual ?? 0)) return { field: 'cantidad', message: `Excede el stock disponible de ${fmt(stockActual)}.` };
  if (requireActivo && !form.activoId) return { field: 'activoId', message: 'El campo Activo es obligatorio.' };
  if (!form.operarioId) return { field: 'operarioId', message: 'El campo Operario es obligatorio.' };
  if (form.nota && form.nota.length > 500) return { field: 'nota', message: 'Nota demasiado larga (máx 500).' };
  return null;
}

// Un form de movimiento "tiene contenido" → al cerrar conviene confirmar descarte.
export const movFormDirty = (form) =>
  !!(form.cantidad || form.nota || form.loteId || form.laborId || form.activoId || form.operarioId);
export const entradaFormDirty = (form, file) =>
  !!(form.cantidad || form.factura || form.oc || form.total || file);
export const itemFormDirty = (data) =>
  !!(data.nombre || data.unidad || data.stockActual || data.stockMinimo || data.descripcion || data.total);

export const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    resolve({ base64: dataUrl.split(',')[1], mediaType: file.type });
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// ── Opciones predefinidas de unidad ────────────────────────────────────────
export const UNIDAD_OPTIONS = [
  'litros', 'galones', 'kg', 'gramos', 'libras', 'unidades',
  'metros', 'pies', 'pulgadas', 'rollos', 'cajas', 'sacos',
  'toneladas', 'quintales', 'bolsas', 'pares', 'juegos',
];

// ── Columnas de movimientos ────────────────────────────────────────────────
export const MOV_COLUMNS = [
  { key: 'fecha',       label: 'Fecha',           type: 'date'   },
  { key: 'producto',    label: 'Producto',        type: 'text'   },
  { key: 'tipo',        label: 'Tipo',            type: 'text'   },
  { key: 'cantidad',    label: 'Cantidad',        type: 'number', align: 'right' },
  { key: 'stockAntes',  label: 'Stock anterior',  type: 'number', align: 'right' },
  { key: 'stockDesp',   label: 'Stock resultante',type: 'number', align: 'right' },
  { key: 'factura',     label: 'Factura',         type: 'text'   },
  { key: 'oc',          label: 'OC',              type: 'text'   },
  { key: 'total',       label: 'Total',           type: 'number', align: 'right' },
  { key: 'totalSalida', label: 'Total salida',    type: 'number', align: 'right' },
  { key: 'activo',      label: 'Activo',          type: 'text'   },
  { key: 'operario',    label: 'Operario',        type: 'text'   },
  { key: 'lote',        label: 'Lote',            type: 'text'   },
  { key: 'labor',       label: 'Labor',           type: 'text'   },
  { key: 'nota',        label: 'Nota',            type: 'text'   },
];

// Columnas ocultas por default (igual van en el menú, solo arrancan off).
const DEFAULT_HIDDEN_COLS = new Set(['totalSalida']);

export const LS_MOV_COLS = 'aurora_bodega_mov_cols';

// La preferencia de columnas se persiste POR BODEGA: combustibles y una bodega
// genérica de repuestos no comparten qué columnas importan (ej. "Labor").
const colsKey = (bodegaKey) => (bodegaKey ? `${LS_MOV_COLS}:${bodegaKey}` : LS_MOV_COLS);

export function loadVisibleCols(bodegaKey = '') {
  const base = Object.fromEntries(
    MOV_COLUMNS.map(c => [c.key, !DEFAULT_HIDDEN_COLS.has(c.key)])
  );
  try {
    // Fallback a la clave global legacy si todavía no hay preferencia por-bodega.
    const saved = localStorage.getItem(colsKey(bodegaKey)) || localStorage.getItem(LS_MOV_COLS);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Mezcla con base para tolerar columnas nuevas agregadas tras guardar.
      return { ...base, ...parsed };
    }
  } catch { /* ignore */ }
  return base;
}

export function saveVisibleCols(cols, bodegaKey = '') {
  try { localStorage.setItem(colsKey(bodegaKey), JSON.stringify(cols)); } catch { /* ignore */ }
}

export function getMovVal(m, key) {
  switch (key) {
    case 'fecha':       return m.timestamp?.slice?.(0, 10) || m.timestamp || '';
    case 'producto':    return (m.itemNombre || '').toLowerCase();
    case 'tipo':        return (m.tipo || '').toLowerCase();
    case 'cantidad':    return m.cantidad || 0;
    case 'stockAntes':  return m.stockAntes || 0;
    case 'stockDesp':   return m.stockDespues || 0;
    case 'factura':     return (m.factura || '').toLowerCase();
    case 'oc':          return (m.oc || '').toLowerCase();
    case 'total':       return m.total ?? 0;
    case 'totalSalida': return m.totalSalida ?? 0;
    case 'activo':      return (m.activoNombre || '').toLowerCase();
    case 'operario':    return (m.operarioNombre || '').toLowerCase();
    case 'lote':        return (m.loteNombre || '').toLowerCase();
    case 'labor':       return (m.laborNombre || '').toLowerCase();
    case 'nota':        return (m.nota || '').toLowerCase();
    default:            return '';
  }
}
