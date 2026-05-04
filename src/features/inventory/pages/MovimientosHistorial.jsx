import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { FiSearch, FiX, FiArrowUp, FiArrowDown, FiFilter, FiSliders } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/agroquimicos.css';
import '../../planting/styles/siembra-historial.css';

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

const E = () => <span className="hist-empty">—</span>;

// ── Column definitions per tab ──────────────────────────────────────────────
const COLS_CONSOLIDADO = [
  { key: 'fecha',          label: 'Fecha',           type: 'date'   },
  { key: 'tipo',           label: 'Tipo',            type: 'text'   },
  { key: 'referencia',     label: 'Referencia',      type: 'text'   },
  { key: 'detalle',        label: 'Detalle',         type: 'text'   },
  { key: 'idProducto',     label: 'ID Producto',     type: 'text'   },
  { key: 'nombreComercial',label: 'Nombre Comercial',type: 'text'   },
  { key: 'unidad',         label: 'UM',              type: 'text'   },
  { key: 'entrada',        label: 'Entrada',         type: 'number' },
  { key: 'salida',         label: 'Salida',          type: 'number' },
];

const COLS_INGRESOS = [
  { key: 'fecha',          label: 'Fecha',           type: 'date'   },
  { key: 'recepcion',      label: 'Recepción',       type: 'text'   },
  { key: 'facturaNumero',  label: 'Factura',         type: 'text'   },
  { key: 'proveedor',      label: 'Proveedor',       type: 'text'   },
  { key: 'ocPoNumber',     label: 'OC',              type: 'text'   },
  { key: 'idProducto',     label: 'ID Producto',     type: 'text'   },
  { key: 'nombreComercial',label: 'Nombre Comercial',type: 'text'   },
  { key: 'unidad',         label: 'UM',              type: 'text'   },
  { key: 'cantidad',       label: 'Cantidad',        type: 'number' },
  { key: 'precioUnitario', label: 'Precio Unit.',    type: 'number' },
  { key: 'iva',            label: 'IVA',             type: 'number' },
  { key: 'total',          label: 'Total',           type: 'number' },
];

const COLS_EGRESOS = [
  { key: 'fecha',          label: 'Fecha',           type: 'date'   },
  { key: 'consecutivo',    label: 'Consecutivo',     type: 'text'   },
  { key: 'motivo',         label: 'Aplicación',      type: 'text'   },
  { key: 'lote',           label: 'Lote',            type: 'text'   },
  { key: 'grupo',          label: 'Grupo',           type: 'text'   },
  { key: 'idProducto',     label: 'ID Producto',     type: 'text'   },
  { key: 'nombreComercial',label: 'Nombre Comercial',type: 'text'   },
  { key: 'unidad',         label: 'UM',              type: 'text'   },
  { key: 'totalEgreso',    label: 'Total',           type: 'number' },
];

function getColsForTab(tab) {
  if (tab === 'ingresos') return COLS_INGRESOS;
  if (tab === 'egresos')  return COLS_EGRESOS;
  return COLS_CONSOLIDADO;
}

function makeAllVisible(cols) {
  return Object.fromEntries(cols.map(c => [c.key, true]));
}

// ── Value extractors for sort / filter ──────────────────────────────────────
function getRowVal(m, key, prodMap) {
  const prod = prodMap[m.productoId];
  switch (key) {
    case 'fecha':           return m.fecha?.slice(0, 10) || '';
    case 'tipo':            return m.tipo || '';
    case 'referencia': {
      if (m.tipo === 'ingreso') return (m.facturaNumero || m.ocPoNumber || '').toLowerCase();
      return (m.cedulaConsecutivo || (m.tareaId ? `T-${m.tareaId.slice(-6).toUpperCase()}` : '')).toLowerCase();
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
    case 'salida':          return (m.tipo === 'egreso' || m.tipo === 'anulacion_ingreso') ? (parseFloat(m.cantidad) || 0) : 0;
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
    case 'consecutivo':
      return (m.cedulaConsecutivo || (m.tareaId ? `T-${m.tareaId.slice(-6).toUpperCase()}` : '')).toLowerCase();
    case 'motivo':          return (m.motivo || '').toLowerCase();
    case 'lote':
      return m.grupoId ? '' : (m.loteNombre || '').toLowerCase();
    case 'grupo':
      return (m.grupoId ? (m.grupoNombre || m.loteNombre || '') : (m.grupoNombre || '')).toLowerCase();
    case 'totalEgreso':     return parseFloat(m.cantidad) || 0;
    default:                return '';
  }
}

// ── ColMenu (portal) ────────────────────────────────────────────────────────
function ColMenu({ x, y, columns, visibleCols, onToggle, onClose }) {
  const menuRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose(); };
    const onKey  = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown',   onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return createPortal(
    <div ref={menuRef} className="sh-col-menu" style={{ position: 'fixed', top: y, left: x }}>
      <div className="sh-col-menu-title">Columnas visibles</div>
      {columns.map(col => {
        const checked = visibleCols[col.key];
        const isLast  = checked && Object.values(visibleCols).filter(Boolean).length === 1;
        return (
          <label key={col.key} className={`sh-col-menu-item${isLast ? ' sh-col-menu-item--disabled' : ''}`}>
            <input type="checkbox" checked={checked} disabled={isLast}
              onChange={() => !isLast && onToggle(col.key)} />
            <span>{col.label}</span>
          </label>
        );
      })}
    </div>,
    document.body
  );
}

// ── SortTh (defined outside render to avoid DOM teardown per render) ─────
function SortTh({ col, className, sortField, sortDir, colFilters, visibleCols, onSort, onOpenFilter, children }) {
  if (!visibleCols[col.key]) return null;
  const isSort  = sortField === col.key;
  const hasFilt = !!colFilters[col.key];
  return (
    <th
      className={`sh-th-sortable${isSort ? ' is-sorted' : ''}${hasFilt ? ' has-col-filter' : ''}${className ? ' ' + className : ''}`}
      onClick={() => onSort(col.key)}
    >
      <span className="sh-th-content">
        {children}
        <span className="sh-th-arrow">{isSort ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
        {(col.type === 'date' || col.type === 'number') && (
          <span
            className={`sh-th-funnel${hasFilt ? ' is-active' : ''}`}
            onClick={e => onOpenFilter(e, col.key, col.type)}
            title="Filtrar columna"
          >
            <FiFilter size={10} />
          </span>
        )}
      </span>
    </th>
  );
}

// ── Settings th (column toggle button) ──────────────────────────────────────
function SettingsTh({ hiddenCount, onColBtnClick }) {
  return (
    <th className="sh-th-settings">
      <button
        className={`sh-col-toggle-btn${hiddenCount > 0 ? ' sh-col-toggle-btn--active' : ''}`}
        onClick={onColBtnClick}
        title="Personalizar columnas"
      >
        <FiSliders size={12} />
        {hiddenCount > 0 && <span className="sh-col-hidden-badge">{hiddenCount}</span>}
      </button>
    </th>
  );
}

function MovimientosHistorial() {
  const apiFetch = useApiFetch();
  const [movimientos, setMovimientos] = useState([]);
  const [productos,   setProductos]   = useState([]);
  const [loading,     setLoading]     = useState(true);

  const location = useLocation();
  const initialTab = (() => {
    const t = new URLSearchParams(location.search).get('tab');
    return ['consolidado', 'ingresos', 'egresos'].includes(t) ? t : 'consolidado';
  })();
  const [tab,        setTab]        = useState(initialTab);
  const [searchProd, setSearchProd] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  // ── Sort / filter / visibility state ──────────────────────────────────────
  const [sortField,     setSortField]     = useState('fecha');
  const [sortDir,       setSortDir]       = useState('desc');
  const [colFilters,    setColFilters]    = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [visibleCols,   setVisibleCols]   = useState(makeAllVisible(getColsForTab(initialTab)));
  const [colMenu,       setColMenu]       = useState(null);

  const currentCols = getColsForTab(tab);

  // Reset sort/filter/visibility when switching tabs
  const changeTab = (newTab) => {
    setTab(newTab);
    setSortField('fecha');
    setSortDir('desc');
    setColFilters({});
    setFilterPopover(null);
    setVisibleCols(makeAllVisible(getColsForTab(newTab)));
    setColMenu(null);
  };

  useEffect(() => {
    Promise.all([
      apiFetch('/api/movimientos').then(r => r.json()),
      apiFetch('/api/productos').then(r => r.json()),
    ])
      .then(([movs, prods]) => { setMovimientos(movs); setProductos(prods); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const prodMap = useMemo(() => {
    const m = {};
    productos.forEach(p => { m[p.id] = p; });
    return m;
  }, [productos]);

  // ── Sort handler (3-click cycle: desc → asc → off) ───────────────────────
  const handleThSort = (field) => {
    if (sortField !== field) { setSortField(field); setSortDir('desc'); }
    else if (sortDir === 'desc') { setSortDir('asc'); }
    else { setSortField(null); setSortDir(null); }
  };

  // ── Column filter handlers ────────────────────────────────────────────────
  const openColFilter = (e, field, type) => {
    e.stopPropagation();
    if (filterPopover?.field === field) { setFilterPopover(null); return; }
    const th = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    const x = Math.min(rect.left, window.innerWidth - 280);
    setFilterPopover({ field, type, x: Math.max(8, x), y: rect.bottom + 4 });
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
  };

  // ── Column visibility ─────────────────────────────────────────────────────
  const toggleCol = (key) => {
    setVisibleCols(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu({ x: Math.min(r.right - 185, window.innerWidth - 195), y: r.bottom + 4 });
  };

  // ── Base filter (search + date range) ─────────────────────────────────────
  const baseFiltered = useMemo(() => {
    return movimientos.filter(m => {
      if (searchProd) {
        const q    = searchProd.toLowerCase();
        const prod = prodMap[m.productoId];
        const idOk   = (m.idProducto || prod?.idProducto || '').toLowerCase().includes(q);
        const nameOk = (m.nombreComercial || '').toLowerCase().includes(q);
        if (!idOk && !nameOk) return false;
      }
      if (fechaDesde || fechaHasta) {
        const fechaStr = m.fecha?.slice(0, 10) || '';
        if (!fechaStr) return false;
        if (fechaDesde && fechaStr < fechaDesde) return false;
        if (fechaHasta && fechaStr > fechaHasta) return false;
      }
      return true;
    });
  }, [movimientos, searchProd, fechaDesde, fechaHasta, prodMap]);

  // ── Tab filter → column filters → sort ────────────────────────────────────
  const { filtered, tabTotal } = useMemo(() => {
    // 1. Tab filter
    let data;
    if (tab === 'consolidado') data = [...baseFiltered];
    else data = baseFiltered.filter(m => tab === 'ingresos' ? m.tipo === 'ingreso' : m.tipo === 'egreso');

    const tabTotal = data.length;

    // 2. Column filters
    const activeColFilters = Object.entries(colFilters).filter(([, fv]) => {
      if (fv.text !== undefined) return fv.text.trim();
      return fv.from || fv.to;
    });
    if (activeColFilters.length > 0) {
      data = data.filter(m => {
        for (const [key, fv] of activeColFilters) {
          const col = currentCols.find(c => c.key === key);
          if (!col) continue;
          const val = getRowVal(m, key, prodMap);
          if (col.type === 'text') {
            if (fv.text && !String(val).includes(fv.text.toLowerCase())) return false;
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

    // 3. Sort
    if (sortField && sortDir) {
      data.sort((a, b) => {
        const av = getRowVal(a, sortField, prodMap);
        const bv = getRowVal(b, sortField, prodMap);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return { filtered: data, tabTotal };
  }, [baseFiltered, tab, colFilters, sortField, sortDir, currentCols, prodMap]);

  const ingresosCount = useMemo(() => movimientos.filter(m => m.tipo === 'ingreso').length, [movimientos]);
  const egresosCount  = useMemo(() => movimientos.filter(m => m.tipo === 'egreso').length,  [movimientos]);

  // ── Saldo (Kardex) ────────────────────────────────────────────────────────
  const uniqueProductoIds = useMemo(
    () => [...new Set(baseFiltered.map(m => m.productoId))],
    [baseFiltered],
  );
  const isSingleProduct = uniqueProductoIds.length === 1;

  const saldoMap = useMemo(() => {
    if (!isSingleProduct) return {};
    const productoId = uniqueProductoIds[0];
    const producto   = prodMap[productoId];
    const stockActual = parseFloat(producto?.stockActual) || 0;
    const todos = movimientos
      .filter(m => m.productoId === productoId)
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    const netTotal = todos.reduce((s, m) => {
      const cant = parseFloat(m.cantidad) || 0;
      return m.tipo === 'ingreso' ? s + cant : s - cant;
    }, 0);
    const opening = stockActual - netTotal;
    const map = {};
    let balance = opening;
    for (const m of todos) {
      const cant = parseFloat(m.cantidad) || 0;
      balance += m.tipo === 'ingreso' ? cant : -cant;
      map[m.id] = balance;
    }
    return map;
  }, [isSingleProduct, uniqueProductoIds, movimientos, prodMap]);

  // ── Shared props for SortTh ───────────────────────────────────────────────
  const sortThProps = { sortField, sortDir, colFilters, visibleCols, onSort: handleThSort, onOpenFilter: openColFilter };

  const hasFilters = searchProd || fechaDesde || fechaHasta;

  if (loading) return <div className="pg-page-loading" />;

  const hiddenCount = Object.values(visibleCols).filter(v => !v).length;

  return (
    <div className="lote-management-layout">
      <div className="aur-sheet">

        {/* ── Encabezado + filtros ── */}
        <div className="mhist-header">
          <div className="lote-page-title-block">
            <h2>Historial de Movimientos</h2>
            <p className="lote-page-hint">
              Rastrea cada entrada, salida y ajuste de existencias en bodega para auditar el movimiento de tus agroquímicos.{' '}
              <Link to="/bodega/agroquimicos/existencias">Ir a Existencias</Link>
            </p>
          </div>
          <div className="mhist-filters">
            <div className="mhist-search-wrap">
              <FiSearch size={14} className="mhist-search-icon" />
              <input
                className="mhist-search"
                value={searchProd}
                onChange={e => setSearchProd(e.target.value)}
                placeholder="Buscar producto…"
              />
              {searchProd && (
                <button className="mhist-clear" onClick={() => setSearchProd('')} title="Limpiar búsqueda">
                  <FiX size={13} />
                </button>
              )}
            </div>
            <div className="mhist-date-field">
              <label className="mhist-date-label">Desde</label>
              <input type="date" className="mhist-date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} />
            </div>
            <div className="mhist-date-field">
              <label className="mhist-date-label">Hasta</label>
              <input type="date" className="mhist-date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
            </div>
            {hasFilters && (
              <button className="mhist-reset" onClick={() => { setSearchProd(''); setFechaDesde(''); setFechaHasta(''); }}>
                <FiX size={13} /> Limpiar
              </button>
            )}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="mhist-tabs">
          <button className={`mhist-tab${tab === 'consolidado' ? ' mhist-tab--active' : ''}`} onClick={() => changeTab('consolidado')}>
            Consolidado
          </button>
          <button className={`mhist-tab${tab === 'ingresos' ? ' mhist-tab--active' : ''}`} onClick={() => changeTab('ingresos')}>
            Ingresos <span className="mhist-tab-count">{ingresosCount}</span>
          </button>
          <button className={`mhist-tab${tab === 'egresos' ? ' mhist-tab--active' : ''}`} onClick={() => changeTab('egresos')}>
            Egresos <span className="mhist-tab-count">{egresosCount}</span>
          </button>
        </div>

        {/* ── Hint de saldo ── */}
        {tab === 'consolidado' && isSingleProduct && (
          <div className="mhist-saldo-hint">
            Mostrando kardex para <strong>{prodMap[uniqueProductoIds[0]]?.nombreComercial || uniqueProductoIds[0]}</strong>.
            Saldo calculado a partir del stock actual registrado.
          </div>
        )}

        {/* ── Result count + clear col filters ── */}
        <div className="mhist-result-row">
          <span className="sh-result-count">
            {filtered.length === tabTotal
              ? `${filtered.length} movimientos`
              : `${filtered.length} de ${tabTotal} movimientos`}
          </span>
          {Object.keys(colFilters).length > 0 && (
            <button className="sh-clear-col-filters" onClick={() => setColFilters({})}>
              <FiX size={11} /> Limpiar filtros de columna
            </button>
          )}
        </div>

        {/* ── Contenido ── */}
        {filtered.length === 0 ? (
          <p className="empty-state">
            No hay movimientos{hasFilters || Object.keys(colFilters).length ? ' con los filtros actuales' : ''}.
          </p>
        ) : tab === 'consolidado' ? (
          <ConsolidadoTable rows={filtered} prodMap={prodMap} saldoMap={saldoMap} showSaldo={isSingleProduct}
            visibleCols={visibleCols} sortThProps={sortThProps} columns={currentCols}
            hiddenCount={hiddenCount} onColBtnClick={handleColBtnClick} />
        ) : tab === 'ingresos' ? (
          <IngresoTable rows={filtered} visibleCols={visibleCols} sortThProps={sortThProps} columns={currentCols}
            hiddenCount={hiddenCount} onColBtnClick={handleColBtnClick} />
        ) : (
          <EgresoTable rows={filtered} prodMap={prodMap} visibleCols={visibleCols} sortThProps={sortThProps} columns={currentCols}
            hiddenCount={hiddenCount} onColBtnClick={handleColBtnClick} />
        )}

      </div>

      {/* ── Column visibility menu portal ── */}
      {colMenu && (
        <ColMenu x={colMenu.x} y={colMenu.y} columns={currentCols} visibleCols={visibleCols} onToggle={toggleCol} onClose={() => setColMenu(null)} />
      )}

      {/* ── Column filter popover portal ── */}
      {filterPopover && createPortal(
        <>
          <div className="sh-filter-backdrop" onClick={() => setFilterPopover(null)} />
          <div className="sh-filter-popover mhist-filter-popover" style={{ left: filterPopover.x, top: filterPopover.y }}>
            <div className="sh-filter-range">
              <span className="sh-filter-range-label">De</span>
              <input className="sh-filter-input sh-filter-input-range"
                autoFocus
                type={filterPopover.type === 'date' ? 'date' : 'number'}
                value={colFilters[filterPopover.field]?.from || ''}
                onChange={e => setColFilter(filterPopover.field, filterPopover.type, 'from', e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
              />
              <span className="sh-filter-range-label">A</span>
              <input className="sh-filter-input sh-filter-input-range"
                type={filterPopover.type === 'date' ? 'date' : 'number'}
                value={colFilters[filterPopover.field]?.to || ''}
                onChange={e => setColFilter(filterPopover.field, filterPopover.type, 'to', e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
              />
              {(colFilters[filterPopover.field]?.from || colFilters[filterPopover.field]?.to) && (
                <button className="sh-filter-clear" onClick={() => { setColFilter(filterPopover.field, filterPopover.type, 'from', ''); setColFilter(filterPopover.field, filterPopover.type, 'to', ''); setFilterPopover(null); }}>
                  <FiX size={13} />
                </button>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

/* ── Tabla Consolidada (Kardex) ───────────────────────────────────────────── */
function ConsolidadoTable({ rows, prodMap, saldoMap, showSaldo, visibleCols, sortThProps, columns, hiddenCount, onColBtnClick }) {
  const colDef = (key) => columns.find(c => c.key === key);
  return (
    <div className="hist-table-wrap">
      <table className="hist-table">
        <thead>
          <tr>
            <SortTh col={colDef('fecha')} {...sortThProps}>Fecha</SortTh>
            <SortTh col={colDef('tipo')} {...sortThProps}>Tipo</SortTh>
            <SortTh col={colDef('referencia')} {...sortThProps}>Referencia</SortTh>
            <SortTh col={colDef('detalle')} {...sortThProps}>Detalle</SortTh>
            <SortTh col={colDef('idProducto')} {...sortThProps}>ID Producto</SortTh>
            <SortTh col={colDef('nombreComercial')} {...sortThProps}>Nombre Comercial</SortTh>
            <SortTh col={colDef('unidad')} {...sortThProps}>UM</SortTh>
            <SortTh col={colDef('entrada')} className="hist-col-num mhist-col-entrada" {...sortThProps}>Entrada</SortTh>
            <SortTh col={colDef('salida')} className="hist-col-num mhist-col-salida" {...sortThProps}>Salida</SortTh>
            {showSaldo && <th className="hist-col-num mhist-col-saldo">Saldo</th>}
            <SettingsTh hiddenCount={hiddenCount} onColBtnClick={onColBtnClick} />
          </tr>
        </thead>
        <tbody>
          {rows.map(m => {
            const prod       = prodMap[m.productoId];
            const idProducto = m.idProducto || prod?.idProducto || '';
            const cant       = parseFloat(m.cantidad) || 0;
            const isIngreso  = m.tipo === 'ingreso';
            const isAnulacion = m.tipo === 'anulacion_ingreso';
            const referencia = isIngreso
              ? (m.facturaNumero || m.ocPoNumber || <E />)
              : (m.cedulaConsecutivo || (m.tareaId ? `T-${m.tareaId.slice(-6).toUpperCase()}` : <E />));
            const fuenteEgreso = m.loteNombre || m.grupoNombre || '';
            const detalle = isIngreso
              ? (m.proveedor || <E />)
              : (m.motivo ? (fuenteEgreso ? `${m.motivo} · ${fuenteEgreso}` : m.motivo) : <E />);
            const saldo = saldoMap[m.id];

            return (
              <tr
                key={m.id}
                className={[
                  isIngreso ? 'mhist-row-ingreso' : 'mhist-row-egreso',
                  m.recepcionAnulada ? 'mhist-row-anulada' : '',
                ].filter(Boolean).join(' ')}
              >
                {visibleCols.fecha && <td className="hist-col-fecha">{formatDate(m.fecha)}</td>}
                {visibleCols.tipo && (
                  <td>
                    <span className={`mhist-tipo-badge mhist-tipo-badge--${m.tipo}`}>
                      {isIngreso
                        ? <><FiArrowDown size={11} /> Ingreso</>
                        : isAnulacion
                          ? <><FiArrowUp size={11} /> Anulación</>
                          : <><FiArrowUp size={11} /> Egreso</>}
                    </span>
                  </td>
                )}
                {visibleCols.referencia && <td className="mhist-col-ref">{referencia}</td>}
                {visibleCols.detalle && <td className="mhist-col-detalle">{detalle}</td>}
                {visibleCols.idProducto && <td>{idProducto || <E />}</td>}
                {visibleCols.nombreComercial && <td className="hist-col-name">{m.nombreComercial || prod?.nombreComercial || <E />}</td>}
                {visibleCols.unidad && <td>{m.unidad || prod?.unidad || <E />}</td>}
                {visibleCols.entrada && (
                  <td className="hist-col-num mhist-col-entrada">
                    {isIngreso
                      ? <span className="mhist-val-entrada">{cant.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</span>
                      : <E />}
                  </td>
                )}
                {visibleCols.salida && (
                  <td className="hist-col-num mhist-col-salida">
                    {!isIngreso
                      ? <span className="mhist-val-salida">{cant.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</span>
                      : <E />}
                  </td>
                )}
                {showSaldo && (
                  <td className="hist-col-num mhist-col-saldo">
                    {saldo !== undefined
                      ? <span className={saldo < 0 ? 'mhist-saldo-neg' : 'mhist-saldo-pos'}>
                          {saldo.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
                        </span>
                      : <E />}
                  </td>
                )}
                <td />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Tabla Ingresos ───────────────────────────────────────────────────────── */
function IngresoTable({ rows, visibleCols, sortThProps, columns, hiddenCount, onColBtnClick }) {
  const colDef = (key) => columns.find(c => c.key === key);
  return (
    <div className="hist-table-wrap">
      <table className="hist-table">
        <thead>
          <tr>
            <SortTh col={colDef('fecha')} {...sortThProps}>Fecha</SortTh>
            <SortTh col={colDef('facturaNumero')} {...sortThProps}>Factura</SortTh>
            <SortTh col={colDef('proveedor')} {...sortThProps}>Proveedor</SortTh>
            <SortTh col={colDef('ocPoNumber')} {...sortThProps}>OC</SortTh>
            <SortTh col={colDef('idProducto')} {...sortThProps}>ID Producto</SortTh>
            <SortTh col={colDef('nombreComercial')} {...sortThProps}>Nombre Comercial</SortTh>
            <SortTh col={colDef('unidad')} {...sortThProps}>UM</SortTh>
            <SortTh col={colDef('cantidad')} className="hist-col-num" {...sortThProps}>Cantidad</SortTh>
            <SortTh col={colDef('precioUnitario')} className="hist-col-num" {...sortThProps}>Precio Unit.</SortTh>
            <SortTh col={colDef('iva')} className="hist-col-num" {...sortThProps}>IVA</SortTh>
            <SortTh col={colDef('total')} className="hist-col-num" {...sortThProps}>Total</SortTh>
            <SettingsTh hiddenCount={hiddenCount} onColBtnClick={onColBtnClick} />
          </tr>
        </thead>
        <tbody>
          {rows.map(m => {
            const precioUnit = parseFloat(m.precioUnitario) || 0;
            const cant       = parseFloat(m.cantidad)       || 0;
            const iva        = parseFloat(m.iva)            || 0;
            const total      = cant * precioUnit * (1 + iva / 100);
            return (
              <tr key={m.id} className={m.recepcionAnulada ? 'mhist-row-anulada' : ''}>
                {visibleCols.fecha && <td className="hist-col-fecha">{formatDate(m.fecha)}</td>}
                {visibleCols.recepcion && (
                  <td>
                    {m.recepcionId
                      ? <Link
                          to={`/bodega/agroquimicos/recepciones/${m.recepcionId}`}
                          className="recv-link"
                          title={m.recepcionId}
                        >
                          REC-{m.recepcionId.slice(-6).toUpperCase()}
                        </Link>
                      : <E />}
                  </td>
                )}
                {visibleCols.facturaNumero && <td>{m.facturaNumero || <E />}</td>}
                {visibleCols.proveedor && <td>{m.proveedor || <E />}</td>}
                {visibleCols.ocPoNumber && <td>{m.ocPoNumber || <E />}</td>}
                {visibleCols.idProducto && <td>{m.idProducto || <E />}</td>}
                {visibleCols.nombreComercial && <td className="hist-col-name">{m.nombreComercial || <E />}</td>}
                {visibleCols.unidad && <td>{m.unidad || <E />}</td>}
                {visibleCols.cantidad && <td className="hist-col-num">{cant.toLocaleString('es-CR')}</td>}
                {visibleCols.precioUnitario && (
                  <td className="hist-col-num">
                    {precioUnit > 0
                      ? precioUnit.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                      : <E />}
                  </td>
                )}
                {visibleCols.iva && <td className="hist-col-num">{iva > 0 ? `${iva}%` : <E />}</td>}
                {visibleCols.total && (
                  <td className="hist-col-num hist-col-total">
                    {total > 0
                      ? total.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : <E />}
                  </td>
                )}
                <td />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Tabla Egresos ────────────────────────────────────────────────────────── */
function EgresoTable({ rows, prodMap, visibleCols, sortThProps, columns, hiddenCount, onColBtnClick }) {
  const colDef = (key) => columns.find(c => c.key === key);
  return (
    <div className="hist-table-wrap">
      <table className="hist-table">
        <thead>
          <tr>
            <SortTh col={colDef('fecha')} {...sortThProps}>Fecha</SortTh>
            <SortTh col={colDef('consecutivo')} {...sortThProps}>Consecutivo</SortTh>
            <SortTh col={colDef('motivo')} {...sortThProps}>Aplicación</SortTh>
            <SortTh col={colDef('lote')} {...sortThProps}>Lote</SortTh>
            <SortTh col={colDef('grupo')} {...sortThProps}>Grupo</SortTh>
            <SortTh col={colDef('idProducto')} {...sortThProps}>ID Producto</SortTh>
            <SortTh col={colDef('nombreComercial')} {...sortThProps}>Nombre Comercial</SortTh>
            <SortTh col={colDef('unidad')} {...sortThProps}>UM</SortTh>
            <SortTh col={colDef('totalEgreso')} className="hist-col-num" {...sortThProps}>Total</SortTh>
            <SettingsTh hiddenCount={hiddenCount} onColBtnClick={onColBtnClick} />
          </tr>
        </thead>
        <tbody>
          {rows.map(m => {
            const prod       = prodMap[m.productoId];
            const idProducto = m.idProducto || prod?.idProducto || '';
            const isGrupo    = !!m.grupoId;
            const loteDisplay  = isGrupo ? '' : (m.loteNombre || '');
            const grupoDisplay = isGrupo
              ? (m.grupoNombre || m.loteNombre || '')
              : (m.grupoNombre || '');
            const consecutivo = m.cedulaConsecutivo
              || (m.tareaId ? `T-${m.tareaId.slice(-6).toUpperCase()}` : '—');
            return (
              <tr key={m.id}>
                {visibleCols.fecha && <td className="hist-col-fecha">{formatDate(m.fecha)}</td>}
                {visibleCols.consecutivo && <td className="mhist-col-consec">{consecutivo}</td>}
                {visibleCols.motivo && <td>{m.motivo || <E />}</td>}
                {visibleCols.lote && <td>{loteDisplay || <E />}</td>}
                {visibleCols.grupo && <td>{grupoDisplay || <E />}</td>}
                {visibleCols.idProducto && <td>{idProducto || <E />}</td>}
                {visibleCols.nombreComercial && <td className="hist-col-name">{m.nombreComercial || prod?.nombreComercial || <E />}</td>}
                {visibleCols.unidad && <td>{m.unidad || prod?.unidad || <E />}</td>}
                {visibleCols.totalEgreso && (
                  <td className="hist-col-num hist-col-egreso">
                    {(parseFloat(m.cantidad) || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
                  </td>
                )}
                <td />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default MovimientosHistorial;
