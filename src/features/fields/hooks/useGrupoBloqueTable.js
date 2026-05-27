import { useMemo, useState } from 'react';
import { multiSort } from '../lib/lotes-helpers';
import { consolidateSiembrasByBloque } from '../lib/grupo-bloques-helpers';

/**
 * useGrupoBloqueTable — state + derivaciones de la tabla de bloques del hub
 * de Grupos.
 *
 * Análogo a useBloqueTable (que sirve al hub de Lotes), pero las columnas
 * son distintas (Grupos muestra Lote/Bloque/Ha/Plantas/Material/Kg en vez
 * de Grupo/Bloque/Ha/Plantas/Material) y el default sort es por loteNombre.
 *
 * Encapsula todo lo que vivía suelto en GrupoManagement (sort, filtros por
 * columna, popover del filtro abierto, columnas ocultas, menú de columnas)
 * y las 3 capas de useMemo (rows base → normalizadas con campos derivados
 * ha/material/kg → filtrado → ordenado).
 *
 * Args (objeto):
 *   selectedGrupo — el grupo activo. Si es null el hook devuelve estado
 *                    vacío sin reventar.
 *   siembrasById  — Map<id, siembra> indexado por id. El padre ya lo
 *                    mantiene memoizado a nivel página (lookup O(1)).
 *
 * Returns un objeto destructurable con todo lo necesario para renderizar
 * la tabla, su footer, los popovers de filtro y el menú de columnas.
 */
export default function useGrupoBloqueTable({ selectedGrupo, siembrasById }) {
  const [sorts, setSorts] = useState([{ field: 'loteNombre', dir: 'asc' }]);
  const [colFilters, setColFiltersInternal] = useState({});
  const [filterPop, setFilterPop] = useState(null);
  const [hiddenCols, setHiddenCols] = useState(new Set());
  const [colMenu, setColMenu] = useState(null);

  // Rows base — un row por bloque físico (lote + bloque), consolidando los
  // registros de siembra del grupo. Tolera ids huérfanos vía filter(Boolean).
  const selectedBloques = useMemo(() => {
    if (!selectedGrupo) return [];
    const owned = (selectedGrupo.bloques || [])
      .map(id => siembrasById.get(id))
      .filter(Boolean);
    return consolidateSiembrasByBloque(owned);
  }, [selectedGrupo, siembrasById]);

  // Normaliza con campos derivados que la tabla muestra/ordena/filtra
  // (ha numérico, material string, kg = plantas * 1.6).
  const normalizedRows = useMemo(() =>
    selectedBloques.map(b => ({
      ...b,
      ha:       parseFloat(b.areaCalculada) || 0,
      material: b.materialNombre || b.variedad || '',
      kg:       (b.plantas || 0) * 1.6,
    })),
  [selectedBloques]);

  // Aplica los filtros activos. Soporta texto (includes case-insensitive)
  // y rango numérico (from / to opcionales). Ignora filtros vacíos.
  const filteredRows = useMemo(() => {
    const active = Object.entries(colFilters).filter(([, f]) => {
      if (!f) return false;
      if (f.type === 'range') return !!(f.from?.trim() || f.to?.trim());
      return !!f.value?.trim();
    });
    if (!active.length) return normalizedRows;
    return normalizedRows.filter(r => {
      for (const [field, filter] of active) {
        const cell = r[field];
        if (filter.type === 'range') {
          if (cell == null || cell === '') return false;
          const num = Number(cell);
          if (!isNaN(num)) {
            if (filter.from !== '' && filter.from != null && num < Number(filter.from)) return false;
            if (filter.to   !== '' && filter.to   != null && num > Number(filter.to))   return false;
          } else {
            const str = String(cell);
            if (filter.from && str < filter.from) return false;
            if (filter.to   && str > filter.to)   return false;
          }
        } else {
          if (cell == null) return false;
          if (!String(cell).toLowerCase().includes(filter.value.toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [normalizedRows, colFilters]);

  const sortedRows = useMemo(() => multiSort(filteredRows, sorts), [filteredRows, sorts]);

  // Totales del subset que el usuario está viendo después de filtrar.
  const filtTotalHa      = sortedRows.reduce((s, b) => s + (b.ha || 0), 0);
  const filtTotalPlantas = sortedRows.reduce((s, b) => s + (b.plantas || 0), 0);
  const filtTotalKg      = filtTotalPlantas * 1.6;

  // setColFilter con auto-clear si el filtro queda vacío. Mantiene
  // colFilters libre de entradas no-op que ensucien el state.
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
    selectedBloques,    // raw consolidados — el hub lo lee solo para .length
    sortedRows,         // filtered + sorted — la tabla principal
    filtTotalHa, filtTotalPlantas, filtTotalKg,
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
