// Helpers puros del Historial de Movimientos.
//
// Extraídos de MovimientosHistorial.jsx para poder testearlos en aislamiento
// y reutilizarlos sin arrastrar el componente. Sin estado ni efectos: todo
// recibe lo que necesita por parámetro.

// Locale unificado para fechas y números del módulo. Antes la página mezclaba
// `es-ES` para fechas con `es-CR` para números — ahora todo es es-CR.
const LOCALE = 'es-CR';

export const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

// Política única de decimales para cantidades de stock (entradas, salidas,
// saldo, total de egreso). 2 mínimo / 3 máximo. Mantiene coherencia entre
// tabs (antes Ingresos mostraba 0 decimales y Consolidado min2/max3).
export const formatCantidad = (n) =>
  (Number(n) || 0).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 3 });

// Referencia legible de un movimiento de egreso/ajuste: consecutivo de cédula
// o, en su defecto, las últimas 6 del id de tarea en mayúsculas. Antes estaba
// duplicada 4× inline en la página.
export const refDeMovimiento = (m) =>
  m.cedulaConsecutivo || (m.tareaId ? `T-${m.tareaId.slice(-6).toUpperCase()}` : '');

// ── Definiciones de columnas por tab ────────────────────────────────────────
export const COLS_CONSOLIDADO = [
  { key: 'fecha',           label: 'Fecha',            type: 'date'   },
  { key: 'tipo',            label: 'Tipo',             type: 'text'   },
  { key: 'referencia',      label: 'Referencia',       type: 'text'   },
  { key: 'detalle',         label: 'Detalle',          type: 'text'   },
  { key: 'idProducto',      label: 'ID Producto',      type: 'text'   },
  { key: 'nombreComercial', label: 'Nombre Comercial', type: 'text'   },
  { key: 'unidad',          label: 'UM',               type: 'text'   },
  { key: 'entrada',         label: 'Entrada',          type: 'number', align: 'right' },
  { key: 'salida',          label: 'Salida',           type: 'number', align: 'right' },
];

export const COLS_INGRESOS = [
  { key: 'fecha',           label: 'Fecha',            type: 'date'   },
  { key: 'recepcion',       label: 'Recepción',        type: 'text'   },
  { key: 'facturaNumero',   label: 'Factura',          type: 'text'   },
  { key: 'proveedor',       label: 'Proveedor',        type: 'text'   },
  { key: 'ocPoNumber',      label: 'OC',               type: 'text'   },
  { key: 'idProducto',      label: 'ID Producto',      type: 'text'   },
  { key: 'nombreComercial', label: 'Nombre Comercial', type: 'text'   },
  { key: 'unidad',          label: 'UM',               type: 'text'   },
  { key: 'cantidad',        label: 'Cantidad',         type: 'number', align: 'right' },
  { key: 'precioUnitario',  label: 'Precio Unit.',     type: 'number', align: 'right' },
  { key: 'iva',             label: 'IVA',              type: 'number', align: 'right' },
  { key: 'total',           label: 'Total',            type: 'number', align: 'right' },
];

export const COLS_EGRESOS = [
  { key: 'fecha',           label: 'Fecha',            type: 'date'   },
  { key: 'consecutivo',     label: 'Consecutivo',      type: 'text'   },
  { key: 'motivo',          label: 'Aplicación',       type: 'text'   },
  { key: 'lote',            label: 'Lote',             type: 'text'   },
  { key: 'grupo',           label: 'Grupo',            type: 'text'   },
  { key: 'idProducto',      label: 'ID Producto',      type: 'text'   },
  { key: 'nombreComercial', label: 'Nombre Comercial', type: 'text'   },
  { key: 'unidad',          label: 'UM',               type: 'text'   },
  { key: 'totalEgreso',     label: 'Total',            type: 'number', align: 'right' },
];

export function getColsForTab(tab) {
  if (tab === 'ingresos') return COLS_INGRESOS;
  if (tab === 'egresos')  return COLS_EGRESOS;
  return COLS_CONSOLIDADO;
}

// Un movimiento cuenta como egreso si NO es un ingreso (egreso real o
// anulación de ingreso). Centralizado para que tab, conteo y render
// coincidan.
export const esEgreso = (m) => m.tipo !== 'ingreso';

// ── Extractor de valores para sort / filter ─────────────────────────────────
// Recibe el array ya enriquecido (cada row con `_prod` resuelto del prodMap)
// para evitar relookups por celda. Acceso O(1) a campos precomputados.
export function makeGetColVal() {
  return (m, key) => {
    const prod = m._prod;
    switch (key) {
      case 'fecha':           return m.fecha?.slice(0, 10) || '';
      case 'tipo':            return m.tipo || '';
      case 'referencia': {
        if (m.tipo === 'ingreso') return (m.facturaNumero || m.ocPoNumber || '').toLowerCase();
        return refDeMovimiento(m).toLowerCase();
      }
      case 'detalle': {
        if (m.tipo === 'ingreso') return (m.proveedor || '').toLowerCase();
        const fuente = m.loteNombre || m.grupoNombre || '';
        return (m.motivo ? (fuente ? `${m.motivo} · ${fuente}` : m.motivo) : '').toLowerCase();
      }
      case 'idProducto':      return (m.idProducto || prod?.idProducto || '').toLowerCase();
      case 'nombreComercial': return (m.nombreComercial || prod?.nombreComercial || '').toLowerCase();
      case 'unidad':          return (m.unidad || prod?.unidad || '').toLowerCase();
      case 'entrada':         return m.tipo === 'ingreso' ? (parseFloat(m.cantidad) || 0) : 0;
      case 'salida':          return esEgreso(m) ? (parseFloat(m.cantidad) || 0) : 0;
      case 'recepcion':       return (m.recepcionId || '').toLowerCase();
      case 'facturaNumero':   return (m.facturaNumero || '').toLowerCase();
      case 'proveedor':       return (m.proveedor || '').toLowerCase();
      case 'ocPoNumber':      return (m.ocPoNumber || '').toLowerCase();
      case 'cantidad':        return parseFloat(m.cantidad) || 0;
      case 'precioUnitario':  return parseFloat(m.precioUnitario) || 0;
      case 'iva':             return parseFloat(m.iva) || 0;
      case 'total': {
        const cant = parseFloat(m.cantidad) || 0;
        const pu   = parseFloat(m.precioUnitario) || 0;
        const iv   = parseFloat(m.iva) || 0;
        return cant * pu * (1 + iv / 100);
      }
      case 'consecutivo':     return refDeMovimiento(m).toLowerCase();
      case 'motivo':          return (m.motivo || '').toLowerCase();
      case 'lote':
        return m.grupoId ? '' : (m.loteNombre || '').toLowerCase();
      case 'grupo':
        return (m.grupoId ? (m.grupoNombre || m.loteNombre || '') : (m.grupoNombre || '')).toLowerCase();
      case 'totalEgreso':     return parseFloat(m.cantidad) || 0;
      default:                return '';
    }
  };
}

// Indexa productos por id Y por idProducto (campo de negocio). Los movimientos
// referencian `productoId`, que normalmente es el doc id, pero algunos flujos
// legacy podrían guardar el idProducto de negocio — indexar por ambos es
// defensivo y barato.
export function buildProdMap(productos) {
  const map = {};
  productos.forEach((p) => {
    if (p.id) map[p.id] = p;
    if (p.idProducto) map[p.idProducto] = p;
  });
  return map;
}
