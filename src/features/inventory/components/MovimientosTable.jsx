import { useMemo, useState } from 'react';
import {
  FiArrowUp, FiArrowDown, FiFilter, FiSliders, FiX, FiList,
} from 'react-icons/fi';
import AuroraFilterPopover from '../../../components/AuroraFilterPopover';
import EmptyState from '../../../components/ui/EmptyState';
import MovColMenu from './MovColMenu';
import { MOV_COLUMNS, getMovVal, fmt, fmtDate } from '../lib/bodega';

// Header ordenable/filtrable a nivel de módulo (antes vivía dentro del render
// del componente padre → se remontaba en cada keystroke). Recibe todo por
// props para no depender del closure.
function MovSortTh({ col, sortField, sortDir, colFilters, visibleCols, onSort, onOpenFilter }) {
  if (!visibleCols[col.key]) return null;
  const isSort  = sortField === col.key;
  const hasFilt = !!colFilters[col.key];
  const arrow   = isSort ? (sortDir === 'desc' ? '↓' : '↑') : '↕';
  return (
    <th
      role="button"
      tabIndex={0}
      aria-label={`Ordenar por ${col.label}`}
      className={`bgm-th-sortable${isSort ? ' is-sorted' : ''}${hasFilt ? ' has-col-filter' : ''}${col.align === 'right' ? ' text-right' : ''}`}
      onClick={() => onSort(col.key)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(col.key); }
      }}
    >
      <span className="bgm-th-content">
        {col.label}
        <span className="bgm-th-arrow">{arrow}</span>
        <button
          type="button"
          className={`bgm-th-funnel${hasFilt ? ' is-active' : ''}`}
          title="Filtrar columna"
          aria-label={hasFilt ? `Editar filtro de ${col.label}` : `Filtrar ${col.label}`}
          onClick={e => onOpenFilter(e, col.key, col.type)}
        >
          <FiFilter size={10} />
        </button>
      </span>
    </th>
  );
}

export default function MovimientosTable({ movs, visibleCols, onToggleCol }) {
  const [sortField, setSortField] = useState('fecha');
  const [sortDir,   setSortDir]   = useState('desc');
  const [colFilters, setColFilters] = useState({});
  const [filterPop,  setFilterPop]  = useState(null);
  const [colMenu,    setColMenu]    = useState(null);

  const handleSort = (field) => {
    if (sortField !== field) { setSortField(field); setSortDir('desc'); }
    else if (sortDir === 'desc') { setSortDir('asc'); }
    else { setSortField(null); setSortDir(null); }
  };

  const openFilter = (e, field, type) => {
    e.stopPropagation();
    if (filterPop?.field === field) { setFilterPop(null); return; }
    const rect = (e.currentTarget.closest('th') ?? e.currentTarget).getBoundingClientRect();
    setFilterPop({ field, type, x: rect.left, y: rect.bottom + 4 });
  };

  const setColFilter = (field, type, key, val) => {
    setColFilters(prev => {
      const cur = prev[field] || (type === 'text' ? { text: '' } : { from: '', to: '' });
      const updated = { ...cur, [key]: val };
      const isEmpty = type === 'text' ? !updated.text : !updated.from && !updated.to;
      if (isEmpty) { const { [field]: _, ...rest } = prev; return rest; }
      return { ...prev, [field]: updated };
    });
  };

  const handleColBtn = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu({ x: r.right - 185, y: r.bottom + 4 });
  };

  const displayMovs = useMemo(() => {
    let data = [...movs];
    const active = Object.entries(colFilters).filter(([, fv]) =>
      fv.text !== undefined ? fv.text.trim() : fv.from || fv.to
    );
    if (active.length) {
      data = data.filter(r => {
        for (const [key, fv] of active) {
          const col = MOV_COLUMNS.find(c => c.key === key);
          if (!col) continue;
          const val = getMovVal(r, key);
          if (col.type === 'text') {
            if (fv.text && !val.includes(fv.text.toLowerCase())) return false;
          } else if (col.type === 'date') {
            if (!val) return false;
            if (fv.from && val < fv.from) return false;
            if (fv.to   && val > fv.to)   return false;
          } else if (col.type === 'number') {
            if (fv.from !== '' && val < Number(fv.from)) return false;
            if (fv.to   !== '' && val > Number(fv.to))   return false;
          }
        }
        return true;
      });
    }
    if (sortField && sortDir) {
      data.sort((a, b) => {
        const av = getMovVal(a, sortField);
        const bv = getMovVal(b, sortField);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return data;
  }, [movs, colFilters, sortField, sortDir]);

  const hasActiveFilters = Object.keys(colFilters).length > 0;
  const hiddenCount = Object.values(visibleCols).filter(v => !v).length;
  const pop = filterPop;
  const popType = pop?.type;

  return (
    <>
      <div className="bg-table-wrap">
        {hasActiveFilters && (
          <button className="bgm-clear-filters" onClick={() => setColFilters({})}>
            <FiX size={11} /> Limpiar filtros
          </button>
        )}
        <table className="bg-table bgm-table">
          <thead>
            <tr>
              {MOV_COLUMNS.map(col => (
                <MovSortTh
                  key={col.key}
                  col={col}
                  sortField={sortField}
                  sortDir={sortDir}
                  colFilters={colFilters}
                  visibleCols={visibleCols}
                  onSort={handleSort}
                  onOpenFilter={openFilter}
                />
              ))}
              <th className="bgm-th-settings">
                <button
                  className={`bgm-col-toggle-btn${hiddenCount > 0 ? ' bgm-col-toggle-btn--active' : ''}`}
                  onClick={handleColBtn}
                  title="Personalizar columnas"
                  aria-label={hiddenCount > 0 ? `Personalizar columnas (${hiddenCount} oculta${hiddenCount === 1 ? '' : 's'})` : 'Personalizar columnas'}
                >
                  <FiSliders size={12} />
                  {hiddenCount > 0 && (
                    <span className="bgm-col-hidden-badge">{hiddenCount}</span>
                  )}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {displayMovs.map(m => (
              <tr key={m.id}>
                {visibleCols.fecha      && <td className="bgm-cell-nowrap">{fmtDate(m.timestamp)}</td>}
                {visibleCols.producto   && <td className="bgm-cell-nowrap">{m.itemNombre}</td>}
                {visibleCols.tipo       && (
                  <td className="bgm-cell-nowrap">
                    <span className={`bg-badge ${m.tipo}`}>
                      {m.tipo === 'entrada' ? <FiArrowDown size={12} /> : <FiArrowUp size={12} />}
                      {m.tipo === 'entrada' ? 'Entrada' : 'Salida'}
                    </span>
                  </td>
                )}
                {visibleCols.cantidad   && <td className="text-right bgm-cell-nowrap">{fmt(m.cantidad)}</td>}
                {visibleCols.stockAntes && <td className="text-right bgm-cell-nowrap">{fmt(m.stockAntes)}</td>}
                {visibleCols.stockDesp  && <td className="text-right bgm-cell-nowrap">{fmt(m.stockDespues)}</td>}
                {visibleCols.factura    && (
                  <td className="bgm-cell-nowrap">
                    {m.facturaUrl
                      ? <a href={m.facturaUrl} target="_blank" rel="noopener noreferrer" className="bg-link">{m.factura || 'Ver'}</a>
                      : (m.factura || '—')}
                  </td>
                )}
                {visibleCols.oc         && <td className="bgm-cell-nowrap">{m.oc || '—'}</td>}
                {visibleCols.total      && <td className="text-right bgm-cell-nowrap">{m.total != null && m.total !== '' ? fmt(m.total) : '—'}</td>}
                {visibleCols.totalSalida && <td className="text-right bgm-cell-nowrap">{m.totalSalida != null ? fmt(m.totalSalida) : '—'}</td>}
                {visibleCols.activo     && <td className="bgm-cell-nowrap">{m.activoNombre || '—'}</td>}
                {visibleCols.operario   && <td className="bgm-cell-nowrap">{m.operarioNombre || '—'}</td>}
                {visibleCols.lote       && <td className="bgm-cell-nowrap">{m.loteNombre || '—'}</td>}
                {visibleCols.labor      && <td className="bgm-cell-nowrap">{m.laborNombre || '—'}</td>}
                {visibleCols.nota       && <td className="bgm-cell-nowrap">{m.nota || '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Sin resultados tras filtrar (hay movimientos pero el filtro deja 0). */}
        {displayMovs.length === 0 && (
          <EmptyState
            variant="compact"
            icon={FiList}
            title="Sin movimientos para estos filtros"
            subtitle="Ajusta o limpia los filtros para ver más movimientos."
            action={
              <button className="aur-btn-pill" onClick={() => setColFilters({})}>
                Limpiar filtros
              </button>
            }
          />
        )}
      </div>

      {/* Filter popover compartido (clampea al viewport). */}
      {pop && (
        popType === 'text' ? (
          <AuroraFilterPopover
            x={pop.x}
            y={pop.y}
            filterType="text"
            textValue={colFilters[pop.field]?.text || ''}
            onTextChange={(value) => setColFilter(pop.field, 'text', 'text', value)}
            onClear={() => setColFilter(pop.field, 'text', 'text', '')}
            onClose={() => setFilterPop(null)}
          />
        ) : (
          <AuroraFilterPopover
            x={pop.x}
            y={pop.y}
            filterType={popType}
            fromValue={colFilters[pop.field]?.from || ''}
            toValue={colFilters[pop.field]?.to || ''}
            onFromChange={(v) => setColFilter(pop.field, popType, 'from', v)}
            onToChange={(v) => setColFilter(pop.field, popType, 'to', v)}
            onClear={() => { setColFilter(pop.field, popType, 'from', ''); setColFilter(pop.field, popType, 'to', ''); }}
            onClose={() => setFilterPop(null)}
          />
        )
      )}

      {/* Column menu */}
      {colMenu && (
        <MovColMenu
          x={colMenu.x} y={colMenu.y}
          visibleCols={visibleCols}
          onToggle={onToggleCol}
          onClose={() => setColMenu(null)}
        />
      )}
    </>
  );
}
