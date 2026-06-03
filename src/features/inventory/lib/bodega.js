// Helpers puros + constantes compartidas por BodegaView (combustibles y genérica).
// Todo lo que no depende de React vive acá para mantener los componentes finos.
import { FiBox, FiTool, FiTruck, FiDroplet, FiPackage } from 'react-icons/fi';

// ── Icon map ───────────────────────────────────────────────────────────────
export const ICON_MAP = { FiBox, FiTool, FiTruck, FiDroplet, FiPackage };

// ── Formateo ───────────────────────────────────────────────────────────────
export const fmt = (n) => (n ?? 0).toLocaleString('es', { maximumFractionDigits: 2 });

export const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
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

// Normaliza coma decimal antes de parseFloat (teclados es-CR usan coma).
export const parseDecimal = (value) => parseFloat(String(value ?? '').replace(',', '.'));

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

export function loadVisibleCols() {
  const base = Object.fromEntries(
    MOV_COLUMNS.map(c => [c.key, !DEFAULT_HIDDEN_COLS.has(c.key)])
  );
  try {
    const saved = localStorage.getItem(LS_MOV_COLS);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Mezcla con base para tolerar columnas nuevas agregadas tras guardar.
      return { ...base, ...parsed };
    }
  } catch { /* ignore */ }
  return base;
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
