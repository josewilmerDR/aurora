import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FiFilter, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../../../pages/HistorialAplicaciones.css';

const PAGE_SIZE = 50;
const COL_FILTER_MAX = 100;
const POPOVER_MIN_WIDTH = 240;

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmtMoney = (n) =>
  n == null ? '—' : '₡' + Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtNum = (n) =>
  n == null ? '—' : Number(n).toLocaleString('es-CR');

function UnitPayrollHistory() {
  const apiFetch = useApiFetch();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(1);

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo,   setFilterTo]   = useState('');
  const [sorts,      setSorts]      = useState([{ field: 'fecha', dir: 'desc' }]);
  const [colFilters, setColFilters] = useState({});
  const [filterPopover, setFilterPopover] = useState(null);

  useEffect(() => {
    apiFetch('/api/hr/planilla-unidad/historial')
      .then(r => r.json())
      .then(data => { setRows(Array.isArray(data) ? data : []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    // Pre-normaliza y pre-parsea para no repetir trabajo en cada row.
    const activeCol = Object.entries(colFilters)
      .filter(([, v]) => v && v.trim())
      .map(([field, val]) => [field, val.toLowerCase()]);
    const fromMs = filterFrom ? new Date(filterFrom + 'T00:00:00').getTime() : null;
    const toMs   = filterTo   ? new Date(filterTo   + 'T23:59:59').getTime() : null;
    return rows.filter(row => {
      if (fromMs != null || toMs != null) {
        const d = row.fecha ? new Date(row.fecha).getTime() : NaN;
        if (Number.isNaN(d)) return false;
        if (fromMs != null && d < fromMs) return false;
        if (toMs   != null && d > toMs)   return false;
      }
      for (const [field, val] of activeCol) {
        const cell = row[field];
        if (cell == null) return false;
        if (!String(cell).toLowerCase().includes(val)) return false;
      }
      return true;
    });
  }, [rows, filterFrom, filterTo, colFilters]);

  const sorted = useMemo(() => {
    const active = sorts.filter(s => s.field);
    if (!active.length) return filtered;
    return [...filtered].sort((a, b) => {
      for (const { field, dir } of active) {
        const va = a[field] ?? '';
        const vb = b[field] ?? '';
        const cmp = typeof va === 'string' && typeof vb === 'string'
          ? va.localeCompare(vb, 'es')
          : va < vb ? -1 : va > vb ? 1 : 0;
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }, [filtered, sorts]);

  const visible = useMemo(() => sorted.slice(0, page * PAGE_SIZE), [sorted, page]);

  const handleThSort = (field) => {
    setSorts(prev => {
      const head = prev[0];
      const next = head && head.field === field
        ? { field, dir: head.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' };
      return [next, ...prev.slice(1)];
    });
    setPage(1);
  };

  const openFilter = (e, field) => {
    e.stopPropagation();
    e.preventDefault();
    if (filterPopover?.field === field) { setFilterPopover(null); return; }
    const th = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    // Clamp to viewport to avoid overflow on mobile (360px+).
    const maxX = Math.max(8, window.innerWidth - POPOVER_MIN_WIDTH - 8);
    const x = Math.min(Math.max(8, rect.left), maxX);
    setFilterPopover({ field, x, y: rect.bottom + 4 });
  };

  const setColFilter = (field, val) => {
    const clean = val ? String(val).slice(0, COL_FILTER_MAX) : '';
    setColFilters(prev =>
      clean ? { ...prev, [field]: clean }
            : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field))
    );
    setPage(1);
  };

  const clearAllFilters = () => { setFilterFrom(''); setFilterTo(''); setPage(1); };

  const SortTh = ({ field, children, className }) => {
    const head      = sorts[0];
    const active    = head?.field === field;
    const dir       = active ? head.dir : null;
    const hasFilter = !!(colFilters[field]?.trim());
    return (
      <th
        className={`historial-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-col-filter' : ''}${className ? ' ' + className : ''}`}
        onClick={() => handleThSort(field)}
        onContextMenu={e => openFilter(e, field)}
      >
        {children}
        <span className="historial-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        <span
          className={`historial-th-funnel${hasFilter ? ' is-active' : ''}`}
          onClick={e => openFilter(e, field)}
          title="Filtrar columna (o clic derecho)"
        >
          <FiFilter size={10} />
        </span>
      </th>
    );
  };

  if (loading) return <div className="empty-state">Cargando historial…</div>;

  return (
    <>
      <div className="historial-wrap">

        {/* ── Controles de fecha ── */}
        <div className="historial-controls">
          <div className="historial-control-block">
            <div className="historial-control-row">
              <label className="historial-ctrl-label">Fecha de</label>
              <input
                type="date"
                className="historial-date-input"
                value={filterFrom}
                onChange={e => { setFilterFrom(e.target.value); setPage(1); }}
              />
              <label className="historial-ctrl-label">a</label>
              <input
                type="date"
                className="historial-date-input"
                value={filterTo}
                onChange={e => { setFilterTo(e.target.value); setPage(1); }}
              />
              {(filterFrom || filterTo) && (
                <button className="btn btn-secondary historial-clear-btn" onClick={clearAllFilters}>
                  Limpiar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Contador + aviso filtros de columna ── */}
        <div className="historial-count">
          {sorted.length === 0
            ? 'Sin resultados para los filtros aplicados.'
            : `Mostrando ${visible.length} de ${sorted.length} fila${sorted.length !== 1 ? 's' : ''}`
          }
          {Object.values(colFilters).some(v => v.trim()) && (
            <button
              className="historial-clear-col-filters"
              onClick={() => { setColFilters({}); setPage(1); }}
            >
              <FiX size={11} /> Limpiar filtros de columna
            </button>
          )}
        </div>

        {/* ── Tabla ── */}
        {sorted.length === 0 ? (
          <div className="empty-state">No hay planillas aprobadas en el historial.</div>
        ) : (
          <>
            <div className="historial-table-wrap">
              <table className="historial-table historial-table--wide">
                <thead>
                  <tr>
                    {/* Identificación */}
                    <SortTh field="consecutivo"     className="historial-th-group">N°</SortTh>
                    <SortTh field="fecha"           className="historial-th-group">Fecha</SortTh>
                    <SortTh field="encargadoNombre" className="historial-th-group">Encargado</SortTh>
                    <SortTh field="aprobadoPor"     className="historial-th-group">Aprobado por</SortTh>
                    {/* Segmento */}
                    <SortTh field="loteNombre">Lote</SortTh>
                    <SortTh field="grupo">Grupo</SortTh>
                    <SortTh field="labor">Labor</SortTh>
                    <SortTh field="avanceHa">Avance (Ha)</SortTh>
                    <SortTh field="unidad">Unidad</SortTh>
                    <SortTh field="costoUnitario">Costo Unitario</SortTh>
                    {/* Trabajador */}
                    <SortTh field="trabajadorNombre">Trabajador</SortTh>
                    <SortTh field="cantidad">Cantidad</SortTh>
                    <SortTh field="subtotal">Total</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, idx) => (
                    <tr key={row.id || idx}>
                      <td className="historial-consecutivo">{row.consecutivo || '—'}</td>
                      <td className="historial-td-nowrap">{fmtDate(row.fecha)}</td>
                      <td className="historial-td-nowrap">{row.encargadoNombre || '—'}</td>
                      <td className="historial-td-nowrap">{row.aprobadoPor    || '—'}</td>
                      <td className="historial-td-nowrap">{row.loteNombre     || '—'}</td>
                      <td>{row.grupo  || '—'}</td>
                      <td>{row.labor  || '—'}</td>
                      <td className="historial-td-num">
                        {row.avanceHa ? fmtNum(row.avanceHa) : '—'}
                      </td>
                      <td>{row.unidad || '—'}</td>
                      <td className="historial-td-num">{fmtMoney(row.costoUnitario)}</td>
                      <td className="historial-td-nowrap">{row.trabajadorNombre || '—'}</td>
                      <td className="historial-td-num">
                        {row.cantidad != null ? fmtNum(row.cantidad) : '—'}
                      </td>
                      <td className="historial-td-num">{fmtMoney(row.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {visible.length < sorted.length && (
              <div className="historial-load-more">
                <button className="btn btn-secondary" onClick={() => setPage(p => p + 1)}>
                  Ver más — {sorted.length - visible.length} restante{sorted.length - visible.length !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </>
        )}

      </div>

      {/* ── Popover filtro de columna ── */}
      {filterPopover && createPortal(
        <>
          <div className="historial-filter-backdrop" onClick={() => setFilterPopover(null)} />
          <div
            className="historial-filter-popover"
            style={{ left: filterPopover.x, top: filterPopover.y }}
          >
            <FiFilter size={13} className="historial-filter-popover-icon" />
            <input
              autoFocus
              className="historial-filter-input"
              placeholder="Filtrar…"
              maxLength={COL_FILTER_MAX}
              value={colFilters[filterPopover.field] || ''}
              onChange={e => setColFilter(filterPopover.field, e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setFilterPopover(null); }}
            />
            {colFilters[filterPopover.field] && (
              <button
                className="historial-filter-clear"
                title="Limpiar filtro"
                onClick={() => { setColFilter(filterPopover.field, ''); setFilterPopover(null); }}
              >
                <FiX size={13} />
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

export default UnitPayrollHistory;
