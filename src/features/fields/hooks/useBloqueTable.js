import { useState, useMemo } from 'react';
import { multiSort } from '../lib/lotes-helpers';

/**
 * useBloqueTable — state + derivaciones de la tabla de bloques del hub.
 *
 * Encapsula todo lo que vivía suelto en LoteManagement (sort, filtros por
 * columna, popover del filtro abierto, columnas ocultas, menú de columnas)
 * y las 4 capas de useMemo (rows base → filtrado → ordenado → agrupado).
 * Los totales del footer se derivan del array ya filtrado/ordenado.
 *
 * Args (objeto):
 *   selectedLote — el lote activo. Si es null el hook devuelve estado
 *                  vacío sin reventar; los componentes son responsables
 *                  de chequear `selectedLote` antes de rendear la tabla.
 *   siembras     — lista completa de siembras (cross-finca posible — el
 *                  hook filtra por selectedLote.id).
 *   grupos       — catálogo de grupos para resolver bloque → nombreGrupo.
 *
 * Returns un objeto con todo el state y helpers necesarios para
 * renderizar la tabla, el footer, los popovers de filtro y el menú de
 * columnas. Está diseñado para destructurarse en un solo `const { ... }`.
 */
export default function useBloqueTable({ selectedLote, siembras, grupos }) {
  const [sorts, setSorts] = useState([{ field: 'grupo', dir: 'asc' }]);
  const [colFilters, setColFiltersInternal] = useState({});
  const [filterPop, setFilterPop] = useState(null);
  const [hiddenCols, setHiddenCols] = useState(new Set());
  const [colMenu, setColMenu] = useState(null);

  // Rows base: agrupa siembras del lote por bloque, sumando plantas y ha,
  // y une por grupo cruzando con `grupos.bloques[]`.
  const tableRows = useMemo(() => {
    if (!selectedLote || !siembras.length) return [];
    const loteSiembras = siembras.filter(s => s.loteId === selectedLote.id);
    if (!loteSiembras.length) return [];
    const bloqueData = new Map();
    for (const s of loteSiembras) {
      const key = s.bloque || 'Sin bloque';
      if (!bloqueData.has(key)) bloqueData.set(key, { plantas: 0, ha: 0, materiales: new Set() });
      const d = bloqueData.get(key);
      d.plantas += s.plantas || 0;
      d.ha      += parseFloat(s.areaCalculada) || 0;
      if (s.materialNombre) {
        const mat = s.materialNombre + (s.variedad ? ` · ${s.variedad}` : '');
        d.materiales.add(mat);
      }
    }
    const siembraIds      = new Set(loteSiembras.map(s => s.id));
    const siembraToBloque = new Map(loteSiembras.map(s => [s.id, s.bloque || 'Sin bloque']));
    const bloqueToGrupo   = new Map();
    for (const g of grupos) {
      for (const sid of (g.bloques || [])) {
        if (siembraIds.has(sid)) {
          const label = siembraToBloque.get(sid);
          if (!bloqueToGrupo.has(label)) bloqueToGrupo.set(label, g.nombreGrupo);
        }
      }
    }
    return [...bloqueData.entries()].map(([bloque, d]) => ({
      id:       bloque,
      grupo:    bloqueToGrupo.get(bloque) || 'Sin grupo',
      bloque,
      ha:       d.ha,
      plantas:  d.plantas,
      material: [...d.materiales].join(' / ') || '',
    }));
  }, [selectedLote, siembras, grupos]);

  // Aplica los filtros activos. Soporta texto (includes case-insensitive)
  // y rango numérico (from / to opcionales). Ignora filtros vacíos.
  const filteredRows = useMemo(() => {
    const active = Object.entries(colFilters).filter(([, f]) => {
      if (!f) return false;
      if (f.type === 'range') return !!(f.from?.trim() || f.to?.trim());
      return !!f.value?.trim();
    });
    if (!active.length) return tableRows;
    return tableRows.filter(r => {
      for (const [field, filter] of active) {
        const cell = r[field];
        if (filter.type === 'range') {
          if (cell == null || cell === '') return false;
          const num = Number(cell);
          if (!isNaN(num)) {
            if (filter.from !== '' && filter.from != null && num < Number(filter.from)) return false;
            if (filter.to   !== '' && filter.to   != null && num > Number(filter.to))   return false;
          }
        } else {
          if (cell == null) return false;
          if (!String(cell).toLowerCase().includes(filter.value.toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [tableRows, colFilters]);

  const sortedRows = useMemo(() => multiSort(filteredRows, sorts), [filteredRows, sorts]);

  const totalHa      = sortedRows.reduce((s, b) => s + (b.ha || 0), 0);
  const totalPlantas = sortedRows.reduce((s, b) => s + (b.plantas || 0), 0);

  // Agrupa por grupo para render con subtotales por grupo en el body de
  // la tabla. Preserva el orden de `sortedRows`.
  const groupedRows = useMemo(() => {
    const map = new Map();
    for (const row of sortedRows) {
      if (!map.has(row.grupo)) map.set(row.grupo, []);
      map.get(row.grupo).push(row);
    }
    return [...map.entries()].map(([grupo, rows]) => ({
      grupo,
      rows,
      totalHa:      rows.reduce((s, b) => s + (b.ha || 0), 0),
      totalPlantas: rows.reduce((s, b) => s + (b.plantas || 0), 0),
    }));
  }, [sortedRows]);

  // setColFilter con auto-clear si el filtro queda vacío (sin valores).
  // Mantiene `colFilters` libre de entradas no-op que ensucien el state.
  const setColFilter = (field, filterObj) => {
    const empty = !filterObj ||
      (filterObj.type === 'range' ? !filterObj.from?.trim() && !filterObj.to?.trim() : !filterObj.value?.trim());
    setColFiltersInternal(prev => empty
      ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field))
      : { ...prev, [field]: filterObj }
    );
  };

  const clearColFilters = () => setColFiltersInternal({});

  const hasActiveFilters = Object.values(colFilters).some(f =>
    f && (f.type === 'range' ? f.from?.trim() || f.to?.trim() : f.value?.trim()));

  const openColMenu = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu(prev => prev ? null : { x: r.right - 190, y: r.bottom + 4 });
  };

  const closeColMenu = () => setColMenu(null);

  const toggleHiddenCol = (colId) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      next.has(colId) ? next.delete(colId) : next.add(colId);
      return next;
    });
  };

  const resetHiddenCols = () => setHiddenCols(new Set());

  return {
    // data
    tableRows,        // sin filtrar ni agrupar — para el preview/PDF
    groupedRows,      // filtrado + sorted + agrupado — para la tabla del hub
    totalHa, totalPlantas,
    // sort
    sorts, setSorts,
    // column filters
    colFilters, setColFilter, clearColFilters, hasActiveFilters,
    filterPop, setFilterPop,
    // hidden columns
    hiddenCols, toggleHiddenCol, resetHiddenCols,
    colMenu, openColMenu, closeColMenu,
  };
}
