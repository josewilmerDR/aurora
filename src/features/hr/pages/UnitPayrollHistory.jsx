import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FiFilter, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import AuroraFilterPopover from '../../../components/AuroraFilterPopover';
import '../styles/unit-payroll-history.css';

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
  const hasColFilters = Object.values(colFilters).some(v => v && v.trim());

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

  const clearPeriod = () => { setFilterFrom(''); setFilterTo(''); setPage(1); };

  const SortTh = ({ field, children, className, align }) => {
    const head      = sorts[0];
    const active    = head?.field === field;
    const dir       = active ? head.dir : null;
    const hasFilter = !!(colFilters[field]?.trim());
    return (
      <th
        className={`aur-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-filter' : ''}${className ? ' ' + className : ''}`}
        style={align === 'right' ? { textAlign: 'right' } : undefined}
        onClick={() => handleThSort(field)}
        onContextMenu={e => openFilter(e, field)}
      >
        <span className="aur-th-content">
          {children}
          <span className="aur-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
          <span
            className={`aur-th-funnel${hasFilter ? ' is-active' : ''}`}
            onClick={e => openFilter(e, field)}
            title="Filtrar columna (o clic derecho)"
          >
            <FiFilter size={10} />
          </span>
        </span>
      </th>
    );
  };

  if (loading) {
    return (
      <div className="aur-sheet uph-page">
        <div className="aur-page-loading" />
      </div>
    );
  }

  return (
    <>
      <div className="aur-sheet uph-page">

        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">Historial Salario por Unidad</h1>
            <p className="aur-sheet-subtitle">
              Planillas aprobadas con detalle por fila — encargado, lote, labor, trabajador y total devengado.{' '}
              <Link to="/hr/planilla/horas" className="uph-header-link">Ir a Salario por Unidad →</Link>
            </p>
          </div>
        </header>

        {/* ── Filtros de periodo ── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <h3>Filtros</h3>
            {(filterFrom || filterTo) && (
              <div className="aur-section-actions">
                <button type="button" className="aur-chip aur-chip--ghost" onClick={clearPeriod}>
                  <FiX size={11} /> Limpiar periodo
                </button>
              </div>
            )}
          </div>
          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="uph-from">Desde</label>
              <input
                id="uph-from"
                type="date"
                className="aur-input"
                value={filterFrom}
                onChange={e => { setFilterFrom(e.target.value); setPage(1); }}
              />
            </div>
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="uph-to">Hasta</label>
              <input
                id="uph-to"
                type="date"
                className="aur-input"
                value={filterTo}
                onChange={e => { setFilterTo(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        </section>

        {/* ── Tabla / lista ── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <h3>Historial</h3>
            <span className="aur-section-count">{sorted.length}</span>
            {hasColFilters && (
              <div className="aur-section-actions">
                <button
                  type="button"
                  className="aur-chip aur-chip--ghost"
                  onClick={() => { setColFilters({}); setPage(1); }}
                >
                  <FiX size={11} /> Limpiar filtros de columna
                </button>
              </div>
            )}
          </div>

          {sorted.length === 0 ? (
            <p className="empty-state">
              {rows.length === 0
                ? 'No hay planillas aprobadas en el historial.'
                : 'Sin resultados para los filtros aplicados.'}
            </p>
          ) : (
            <>
              <div className="uph-count">
                Mostrando {visible.length} de {sorted.length} fila{sorted.length !== 1 ? 's' : ''}
              </div>

              <div className="aur-table-wrap uph-table-wrap">
                <table className="aur-table uph-table">
                  <thead>
                    <tr>
                      <SortTh field="consecutivo">N°</SortTh>
                      <SortTh field="fecha">Fecha</SortTh>
                      <SortTh field="encargadoNombre">Encargado</SortTh>
                      <SortTh field="aprobadoPor">Aprobado por</SortTh>
                      <SortTh field="loteNombre">Lote</SortTh>
                      <SortTh field="grupo">Grupo</SortTh>
                      <SortTh field="labor">Labor</SortTh>
                      <SortTh field="avanceHa" align="right">Avance (Ha)</SortTh>
                      <SortTh field="unidad">Unidad</SortTh>
                      <SortTh field="costoUnitario" align="right">Costo Unit.</SortTh>
                      <SortTh field="trabajadorNombre">Trabajador</SortTh>
                      <SortTh field="cantidad" align="right">Cantidad</SortTh>
                      <SortTh field="subtotal" align="right">Total</SortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row, idx) => (
                      <tr key={row.id || idx}>
                        <td data-label="N°"           className="uph-td-consecutivo">{row.consecutivo || '—'}</td>
                        <td data-label="Fecha"        className="uph-td-nowrap">{fmtDate(row.fecha)}</td>
                        <td data-label="Encargado"    className="uph-td-nowrap">{row.encargadoNombre || '—'}</td>
                        <td data-label="Aprobado por" className="uph-td-nowrap">{row.aprobadoPor    || '—'}</td>
                        <td data-label="Lote"         className="uph-td-nowrap">{row.loteNombre     || '—'}</td>
                        <td data-label="Grupo">{row.grupo || '—'}</td>
                        <td data-label="Labor">{row.labor || '—'}</td>
                        <td data-label="Avance (Ha)" className="aur-td-num">
                          {row.avanceHa != null ? fmtNum(row.avanceHa) : '—'}
                        </td>
                        <td data-label="Unidad">{row.unidad || '—'}</td>
                        <td data-label="Costo Unit." className="aur-td-num">{fmtMoney(row.costoUnitario)}</td>
                        <td data-label="Trabajador"  className="uph-td-nowrap">{row.trabajadorNombre || '—'}</td>
                        <td data-label="Cantidad" className="aur-td-num">
                          {row.cantidad != null ? fmtNum(row.cantidad) : '—'}
                        </td>
                        <td data-label="Total" className="aur-td-num uph-td-total">{fmtMoney(row.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {visible.length < sorted.length && (
                <div className="aur-pagination-footer">
                  <button type="button" className="aur-chip" onClick={() => setPage(p => p + 1)}>
                    Ver más — {sorted.length - visible.length} restante{sorted.length - visible.length !== 1 ? 's' : ''}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

      </div>

      {/* ── Popover filtro de columna ── */}
      {filterPopover && (
        <AuroraFilterPopover
          x={filterPopover.x}
          y={filterPopover.y}
          filterType="text"
          textValue={colFilters[filterPopover.field] || ''}
          onTextChange={(value) => setColFilter(filterPopover.field, value)}
          textMaxLength={COL_FILTER_MAX}
          onClear={() => setColFilter(filterPopover.field, '')}
          onClose={() => setFilterPopover(null)}
        />
      )}
    </>
  );
}

export default UnitPayrollHistory;
