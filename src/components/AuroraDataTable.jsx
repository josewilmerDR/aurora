import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiFilter, FiX, FiSliders } from 'react-icons/fi';

// Data table compartido cross-domain. Encapsula:
// - sort tri-estado por columna
// - filter popover por columna (text/number/date)
// - menú de visibilidad de columnas (col-menu portaled)
// - paginación opcional ("Ver más")
//
// Renderiza un .aur-section que contiene la toolbar + .aur-table dentro de
// .aur-table-wrap (con scroll horizontal). Las celdas del body las provee la
// página vía `renderRow(row, visibleCols)`. Todas las clases vienen de
// src/styles/aurora.css (no requiere CSS scoped por dominio).

export default function AuroraDataTable({
  columns,
  data,
  getColVal,
  initialSort = null,
  firstClickDir = 'desc',
  initialVisibleCols,
  pageSize = null,
  resultLabel,
  trailingHead = null,
  trailingCell = null,
  rowClassName,
  rowKey = (row) => row.id || row._id,
  renderRow,
  emptyText = 'No hay registros con los filtros aplicados.',
  resetPaginationKey = 0,
}) {
  const allVisible = useMemo(
    () => Object.fromEntries(columns.map(c => [c.key, true])),
    [columns],
  );
  const [visibleCols, setVisibleCols] = useState(() => initialVisibleCols || allVisible);

  const [sortField, setSortField] = useState(initialSort?.field || null);
  const [sortDir, setSortDir]     = useState(initialSort?.dir   || null);

  const [colFilters, setColFilters]       = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [colMenu, setColMenu]             = useState(null);
  const [page, setPage]                   = useState(1);

  const toggleCol = (key) =>
    setVisibleCols(prev => ({ ...prev, [key]: !prev[key] }));

  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu({ x: r.right - 200, y: r.bottom + 4 });
  };

  // Sort tri-estado: nuevo campo → firstClickDir; mismo campo y firstClickDir → flip; tercer click → clear.
  const handleSort = (field) => {
    const oppositeDir = firstClickDir === 'desc' ? 'asc' : 'desc';
    if (sortField !== field) {
      setSortField(field);
      setSortDir(firstClickDir);
    } else if (sortDir === firstClickDir) {
      setSortDir(oppositeDir);
    } else {
      setSortField(null);
      setSortDir(null);
    }
    setPage(1);
  };

  const openColFilter = (e, field, type) => {
    e.stopPropagation();
    if (filterPopover?.field === field) { setFilterPopover(null); return; }
    const th = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    setFilterPopover({ field, type, x: rect.left, y: rect.bottom + 4 });
  };

  const setColFilter = (field, type, key, val) => {
    setColFilters(prev => {
      const cur = prev[field] || (type === 'text' ? { text: '' } : { from: '', to: '' });
      const updated = { ...cur, [key]: val };
      const isEmpty = type === 'text' ? !updated.text : !updated.from && !updated.to;
      if (isEmpty) {
        const { [field]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [field]: updated };
    });
    setPage(1);
  };

  const clearColFilter = (field) => {
    setColFilters(prev => {
      const { [field]: _, ...rest } = prev;
      return rest;
    });
    setPage(1);
  };

  const displayData = useMemo(() => {
    let out = [...data];

    const activeFilters = Object.entries(colFilters).filter(([, fv]) => {
      if (fv.text !== undefined) return fv.text.trim();
      return fv.from || fv.to;
    });
    if (activeFilters.length > 0) {
      out = out.filter(d => {
        for (const [key, fv] of activeFilters) {
          const col = columns.find(c => c.key === key);
          if (!col) continue;
          const val = getColVal(d, key);
          if (col.type === 'text') {
            if (fv.text && !String(val).includes(fv.text.toLowerCase())) return false;
          } else if (col.type === 'date') {
            if (!val) return false;
            if (fv.from && val < fv.from) return false;
            if (fv.to   && val > fv.to)   return false;
          } else if (col.type === 'number') {
            if (fv.from !== '' && fv.from !== undefined && val < Number(fv.from)) return false;
            if (fv.to   !== '' && fv.to   !== undefined && val > Number(fv.to))   return false;
          }
        }
        return true;
      });
    }

    if (sortField && sortDir) {
      out.sort((a, b) => {
        const av = getColVal(a, sortField);
        const bv = getColVal(b, sortField);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return out;
  }, [data, colFilters, sortField, sortDir, columns, getColVal]);

  // Reset page si la fuente externa cambia.
  useEffect(() => { setPage(1); }, [resetPaginationKey]);

  const visibleData = pageSize ? displayData.slice(0, page * pageSize) : displayData;
  const hasMore     = pageSize ? visibleData.length < displayData.length : false;

  const hiddenCount = Object.values(visibleCols).filter(v => !v).length;
  const total       = data.length;
  const filteredCount = displayData.length;

  return (
    <section className="aur-section">
      <div className="aur-table-toolbar">
        <span className="aur-table-result-count">
          {resultLabel
            ? resultLabel(filteredCount, total)
            : (filteredCount === total ? `${total} registros` : `${filteredCount} de ${total} registros`)}
        </span>
        {Object.keys(colFilters).length > 0 && (
          <button
            className="aur-btn-text"
            type="button"
            onClick={() => { setColFilters({}); setPage(1); }}
          >
            <FiX size={11} /> Limpiar filtros
          </button>
        )}
      </div>

      {filteredCount === 0 ? (
        <p className="empty-state">{emptyText}</p>
      ) : (
        <>
          <div className="aur-table-wrap">
            <table className="aur-table">
              <thead>
                <tr>
                  {columns.map(col => {
                    if (!visibleCols[col.key]) return null;
                    // Columnas con sortable: false renderizan un <th> plano,
                    // sin sort cursor ni filter funnel (útil para columnas
                    // computed/derived donde el sort/filter no aplica).
                    if (col.sortable === false) {
                      return (
                        <th
                          key={col.key}
                          style={col.align === 'right' ? { textAlign: 'right' } : undefined}
                        >
                          {col.label}
                        </th>
                      );
                    }
                    const isSort  = sortField === col.key;
                    const hasFilt = !!colFilters[col.key];
                    return (
                      <th
                        key={col.key}
                        className={`aur-th-sortable${isSort ? ' is-sorted' : ''}${hasFilt ? ' has-filter' : ''}`}
                        style={col.align === 'right' ? { textAlign: 'right' } : undefined}
                        onClick={() => handleSort(col.key)}
                      >
                        <span className="aur-th-content">
                          {col.label}
                          <span className="aur-th-arrow">
                            {isSort ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                          </span>
                          <span
                            className={`aur-th-funnel${hasFilt ? ' is-active' : ''}`}
                            onClick={(e) => openColFilter(e, col.key, col.type)}
                            title="Filtrar columna"
                          >
                            <FiFilter size={10} />
                          </span>
                        </span>
                      </th>
                    );
                  })}
                  {trailingHead}
                  <th className="aur-th-col-menu">
                    <button
                      type="button"
                      className={`aur-col-menu-trigger${hiddenCount > 0 ? ' is-active' : ''}`}
                      onClick={handleColBtnClick}
                      title="Personalizar columnas"
                    >
                      <FiSliders size={12} />
                      {hiddenCount > 0 && (
                        <span className="aur-col-hidden-badge">{hiddenCount}</span>
                      )}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleData.map(row => {
                  const cls = rowClassName ? rowClassName(row) : '';
                  return (
                    <tr key={rowKey(row)} className={cls || undefined}>
                      {renderRow(row, visibleCols)}
                      {trailingCell ? trailingCell(row) : null}
                      <td />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="aur-pagination-footer">
              <button
                type="button"
                className="aur-chip"
                onClick={() => setPage(p => p + 1)}
              >
                Ver más — {displayData.length - visibleData.length} restante{displayData.length - visibleData.length !== 1 ? 's' : ''}
              </button>
            </div>
          )}
        </>
      )}

      {colMenu && (
        <ColMenu
          x={colMenu.x}
          y={colMenu.y}
          columns={columns}
          visibleCols={visibleCols}
          onToggle={toggleCol}
          onClose={() => setColMenu(null)}
        />
      )}

      {filterPopover && createPortal(
        <>
          <div className="aur-filter-backdrop" onClick={() => setFilterPopover(null)} />
          <div
            className="aur-filter-popover"
            style={{
              left: Math.min(filterPopover.x, window.innerWidth - 260),
              top: filterPopover.y,
            }}
          >
            {filterPopover.type === 'text' ? (
              <>
                <FiFilter size={13} className="aur-filter-icon" />
                <input
                  autoFocus
                  className="aur-filter-input"
                  placeholder="Filtrar…"
                  value={colFilters[filterPopover.field]?.text || ''}
                  onChange={(e) => setColFilter(filterPopover.field, 'text', 'text', e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setFilterPopover(null); }}
                />
                {colFilters[filterPopover.field]?.text && (
                  <button
                    type="button"
                    className="aur-filter-clear"
                    onClick={() => { clearColFilter(filterPopover.field); setFilterPopover(null); }}
                  >
                    <FiX size={13} />
                  </button>
                )}
              </>
            ) : (
              <div className="aur-filter-range">
                <span className="aur-filter-range-label">De</span>
                <input
                  className="aur-filter-input aur-filter-input--range"
                  type={filterPopover.type === 'date' ? 'date' : 'number'}
                  value={colFilters[filterPopover.field]?.from || ''}
                  onChange={(e) => setColFilter(filterPopover.field, filterPopover.type, 'from', e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setFilterPopover(null); }}
                />
                <span className="aur-filter-range-label">A</span>
                <input
                  className="aur-filter-input aur-filter-input--range"
                  type={filterPopover.type === 'date' ? 'date' : 'number'}
                  value={colFilters[filterPopover.field]?.to || ''}
                  onChange={(e) => setColFilter(filterPopover.field, filterPopover.type, 'to', e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setFilterPopover(null); }}
                />
                {(colFilters[filterPopover.field]?.from || colFilters[filterPopover.field]?.to) && (
                  <button
                    type="button"
                    className="aur-filter-clear"
                    onClick={() => { clearColFilter(filterPopover.field); setFilterPopover(null); }}
                  >
                    <FiX size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </section>
  );
}

function ColMenu({ x, y, columns, visibleCols, onToggle, onClose }) {
  const menuRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose(); };
    const onKey  = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const visibleCount = Object.values(visibleCols).filter(Boolean).length;

  return createPortal(
    <div ref={menuRef} className="aur-col-menu" style={{ position: 'fixed', top: y, left: x }}>
      <div className="aur-col-menu-title">Columnas visibles</div>
      {columns.map(col => {
        const checked = visibleCols[col.key];
        const isLast  = checked && visibleCount === 1;
        return (
          <label
            key={col.key}
            className={`aur-col-menu-item${isLast ? ' aur-col-menu-item--disabled' : ''}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={isLast}
              onChange={() => !isLast && onToggle(col.key)}
            />
            <span>{col.label}</span>
          </label>
        );
      })}
    </div>,
    document.body,
  );
}
