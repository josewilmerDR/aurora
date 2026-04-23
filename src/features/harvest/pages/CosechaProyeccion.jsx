import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiFilter, FiX, FiSliders } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../../../pages/Siembra.css';
import '../../../pages/SiembraHistorial.css';
import '../styles/cosecha-proyeccion.css';

const PAGE_SIZE = 50;

// ── Column definitions ───────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'fechaCosecha',     label: 'F. Programada',      type: 'date'   },
  { key: 'loteNombre',       label: 'Lote',               type: 'text'   },
  { key: 'grupoNombre',      label: 'Grupo',              type: 'text'   },
  { key: 'bloque',           label: 'Bloque',             type: 'text'   },
  { key: 'cosecha',          label: 'Cosecha',            type: 'text'   },
  { key: 'etapa',            label: 'Etapa',              type: 'text'   },
  { key: 'plantas',          label: 'Plantas',            type: 'number' },
  { key: 'totalKgEsperados', label: 'Total Kg Esperados', type: 'number' },
  { key: 'kgPrimera',        label: 'Kg Primera',         type: 'number' },
  { key: 'kgSegunda',        label: 'Kg Segunda',         type: 'number' },
  { key: 'cajas',            label: 'Cajas',              type: 'number' },
];

const ALL_COLS_VISIBLE = Object.fromEntries(COLUMNS.map(c => [c.key, true]));

// ── ColMenu (column visibility) ──────────────────────────────────────────────
function ColMenu({ x, y, visibleCols, onToggle, onClose }) {
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
      {COLUMNS.map(col => {
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

// ── Helpers ──────────────────────────────────────────────────────────────────
const tsToDate = (ts) => {
  if (!ts) return null;
  if (ts._seconds) return new Date(ts._seconds * 1000);
  return new Date(ts);
};

const calcFechaCosecha = (grupo, config = {}) => {
  const etapa   = (grupo.etapa   || '').toLowerCase();
  const cosecha = (grupo.cosecha || '').toLowerCase();
  let dias;
  if (etapa.includes('postforza') || etapa.includes('post forza')) {
    dias = config.diasPostForza ?? 150;
  } else if (cosecha.includes('ii') || cosecha.includes('2')) {
    dias = config.diasIIDesarrollo ?? 215;
  } else {
    dias = config.diasIDesarrollo ?? 250;
  }
  const base = tsToDate(grupo.fechaCreacion);
  if (!base) return null;
  const result = new Date(base);
  result.setDate(result.getDate() + dias);
  return result;
};

const fmt = (date) => {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const num = (v, dec = 0) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return dec > 0 ? n.toFixed(dec) : n.toLocaleString('es-ES');
};

function getColVal(row, key) {
  if (key === 'fechaCosecha') {
    const d = row.fechaCosecha;
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt)) return '';
    return dt.toISOString().slice(0, 10);
  }
  const v = row[key];
  if (v == null) return COLUMNS.find(c => c.key === key)?.type === 'number' ? 0 : '';
  return typeof v === 'number' ? v : String(v).toLowerCase();
}

// ── Subcomponente: encabezado ordenable + filtro ────────────────────────────
function SortTh({ col, children, visibleCols, sortField, sortDir, colFilters, onSort, onFilter }) {
  if (!visibleCols[col.key]) return null;
  const isSort  = sortField === col.key;
  const hasFilt = !!colFilters[col.key];
  const isNum   = col.type === 'number';
  return (
    <th
      className={`sh-th-sortable${isSort ? ' is-sorted' : ''}${hasFilt ? ' has-col-filter' : ''}`}
      style={isNum ? { textAlign: 'right' } : undefined}
      onClick={() => onSort(col.key)}
    >
      <span className="sh-th-content">
        {children}
        <span className="sh-th-arrow">{isSort ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
        <span
          className={`sh-th-funnel${hasFilt ? ' is-active' : ''}`}
          onClick={e => onFilter(e, col.key, col.type)}
          title="Filtrar columna"
        >
          <FiFilter size={10} />
        </span>
      </span>
    </th>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CosechaProyeccion() {
  const apiFetch = useApiFetch();

  const [grupos,   setGrupos]   = useState([]);
  const [siembras, setSiembras] = useState([]);
  const [config,   setConfig]   = useState({});
  const [loading,  setLoading]  = useState(true);

  const [sortField, setSortField] = useState('fechaCosecha');
  const [sortDir,   setSortDir]   = useState('asc');
  const [colFilters, setColFilters] = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [visibleCols, setVisibleCols] = useState(ALL_COLS_VISIBLE);
  const [colMenu, setColMenu] = useState(null);
  const [page,  setPage]  = useState(1);

  const toggleCol = (key) => setVisibleCols(prev => ({ ...prev, [key]: !prev[key] }));
  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu({ x: r.right - 185, y: r.bottom + 4 });
  };

  // ── Sort handler (3-state: asc → desc → none) ─────────────────────────────
  const handleThSort = (field) => {
    if (sortField !== field) { setSortField(field); setSortDir('asc'); }
    else if (sortDir === 'asc') { setSortDir('desc'); }
    else { setSortField(null); setSortDir(null); }
    setPage(1);
  };

  // ── Column filter helpers ─────────────────────────────────────────────────
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

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/config').then(r => r.json()),
    ])
      .then(([grp, sie, cfg]) => {
        setGrupos(Array.isArray(grp) ? grp : []);
        setSiembras(Array.isArray(sie) ? sie : []);
        setConfig(cfg && typeof cfg === 'object' ? cfg : {});
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // ── Automatic row generation ──────────────────────────────────────────────
  // One row per bloque (siembra) that belongs to a grupo.
  const rows = useMemo(() => {
    const siembraMap = new Map(siembras.map(s => [s.id, s]));
    const result = [];

    for (const grupo of grupos) {
      const bloqueIds = Array.isArray(grupo.bloques) ? grupo.bloques : [];
      if (bloqueIds.length === 0) continue;

      const fechaCosecha = calcFechaCosecha(grupo, config);

      for (const bloqueId of bloqueIds) {
        const siembra = siembraMap.get(bloqueId);
        if (!siembra) continue;

        const cosechaLower = (grupo.cosecha || '').toLowerCase();
        const esIIICosecha = cosechaLower.includes('iii cosecha');
        const esIICosecha  = !esIIICosecha && cosechaLower.includes('ii cosecha');
        const esICosecha   = !esIIICosecha && !esIICosecha && cosechaLower.includes('i cosecha');
        if (!esICosecha && !esIICosecha && !esIIICosecha) continue;

        const plantas  = siembra.plantas || 0;

        let mortalidad, kgXPlanta, rechazo;
        if (esIIICosecha) {
          mortalidad = (config.mortalidadIIICosecha ?? 20) / 100;
          kgXPlanta  = config.kgPorPlantaIII ?? 1.5;
          rechazo    = (config.rechazoIIICosecha ?? 20) / 100;
        } else if (esIICosecha) {
          mortalidad = (config.mortalidadIICosecha ?? 10) / 100;
          kgXPlanta  = config.kgPorPlantaII ?? 1.6;
          rechazo    = (config.rechazoIICosecha ?? 20) / 100;
        } else {
          mortalidad = (config.mortalidadICosecha ?? 2) / 100;
          kgXPlanta  = config.kgPorPlanta ?? 1.8;
          rechazo    = (config.rechazoICosecha ?? 10) / 100;
        }
        const totalKgEsperados = plantas * (1 - mortalidad) * kgXPlanta;
        const kgPrimera        = totalKgEsperados * (1 - rechazo);

        result.push({
          _id:          `${grupo.id}-${bloqueId}`,
          fechaCosecha,                              // F. Programada
          loteNombre:   siembra.loteNombre || '—',  // Lote
          grupoNombre:  grupo.nombreGrupo  || '—',  // Grupo
          bloque:       siembra.bloque     || '—',  // Bloque
          cosecha:      grupo.cosecha      || '—',  // Cosecha
          etapa:        grupo.etapa        || '—',  // Etapa
          plantas,                                  // Plantas
          totalKgEsperados,                         // Plantas × (1-Mortalidad) × Kg/planta
          kgPrimera,                                // totalKgEsperados × (1-Rechazo)
          kgSegunda:        totalKgEsperados - kgPrimera, // totalKgEsperados × Rechazo
          cajas:            (config.kgPorCaja ?? 12) > 0 ? kgPrimera / (config.kgPorCaja ?? 12) : null,
          // Cost/Kg: no data source yet
        });
      }
    }

    return result;
  }, [grupos, siembras, config]);

  // ── Filtrado y ordenamiento ───────────────────────────────────────────────
  const displayData = useMemo(() => {
    let data = [...rows];

    // Column filters
    const activeColFilters = Object.entries(colFilters).filter(([, fv]) => {
      if (fv.text !== undefined) return fv.text.trim();
      return fv.from || fv.to;
    });
    if (activeColFilters.length > 0) {
      data = data.filter(d => {
        for (const [key, fv] of activeColFilters) {
          const col = COLUMNS.find(c => c.key === key);
          if (!col) continue;
          const val = getColVal(d, key);
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

    // Sort
    if (sortField && sortDir) {
      data.sort((a, b) => {
        const av = getColVal(a, sortField);
        const bv = getColVal(b, sortField);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return data;
  }, [rows, colFilters, sortField, sortDir]);

  const visible = useMemo(() => displayData.slice(0, page * PAGE_SIZE), [displayData, page]);
  const hasMore = visible.length < displayData.length;

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <div className="empty-state">Cargando proyecciones…</div>;

  return (
    <div className="sh-layout cosecha-proyeccion-page">

      {/* ── Encabezado ──────────────────────────────────────────────────── */}
      <div className="ch-header">
        <h1 className="ch-title">Proyección de Cosecha</h1>
      </div>

      {/* ── Tabla ───────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="item-main-text">Sin grupos con bloques registrados</p>
          <p>Las proyecciones se generan automáticamente desde el módulo Grupos.</p>
        </div>
      ) : (
        <div className="sh-table-card">
          <div className="historial-top-row">
            <span className="sh-result-count">
              {displayData.length === rows.length
                ? `${rows.length} proyecciones`
                : `${displayData.length} de ${rows.length} proyecciones`}
            </span>
            {Object.keys(colFilters).length > 0 && (
              <button className="sh-clear-col-filters" onClick={() => { setColFilters({}); setPage(1); }}>
                <FiX size={11} /> Limpiar filtros de columna
              </button>
            )}
          </div>

          {displayData.length === 0 ? (
            <p className="empty-state">No hay proyecciones con los filtros aplicados.</p>
          ) : (
            <>
              <div className="siembra-table-wrapper">
                <table className="siembra-table siembra-table-historial proyeccion-table">
                  <thead>
                    <tr>
                      {COLUMNS.map(col => (
                        <SortTh key={col.key} col={col}
                          visibleCols={visibleCols} sortField={sortField} sortDir={sortDir}
                          colFilters={colFilters} onSort={handleThSort} onFilter={openColFilter}
                        >{col.label}</SortTh>
                      ))}
                      {/* Cost/Kg — sin fuente de datos */}
                      <th className="proyeccion-th-na">Cost/Kg</th>
                      {/* Columnas visibles toggle */}
                      {(() => {
                        const hiddenCount = Object.values(visibleCols).filter(v => !v).length;
                        return (
                          <th className="sh-th-settings">
                            <button
                              className={`sh-col-toggle-btn${hiddenCount > 0 ? ' sh-col-toggle-btn--active' : ''}`}
                              onClick={handleColBtnClick}
                              title="Personalizar columnas"
                            >
                              <FiSliders size={12} />
                              {hiddenCount > 0 && (
                                <span className="sh-col-hidden-badge">{hiddenCount}</span>
                              )}
                            </button>
                          </th>
                        );
                      })()}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(row => (
                      <tr key={row._id}>
                        {visibleCols.fechaCosecha     && <td style={{ whiteSpace: 'nowrap' }}>{fmt(row.fechaCosecha)}</td>}
                        {visibleCols.loteNombre       && <td style={{ whiteSpace: 'nowrap' }}>{row.loteNombre}</td>}
                        {visibleCols.grupoNombre      && <td style={{ whiteSpace: 'nowrap' }}>{row.grupoNombre}</td>}
                        {visibleCols.bloque           && <td>{row.bloque}</td>}
                        {visibleCols.cosecha          && <td style={{ whiteSpace: 'nowrap' }}>{row.cosecha}</td>}
                        {visibleCols.etapa            && <td>{row.etapa}</td>}
                        {visibleCols.plantas          && <td className="proyeccion-td-num">{num(row.plantas)}</td>}
                        {visibleCols.totalKgEsperados && <td className="proyeccion-td-num">{num(row.totalKgEsperados, 0)}</td>}
                        {visibleCols.kgPrimera        && <td className="proyeccion-td-num">{num(row.kgPrimera, 0)}</td>}
                        {visibleCols.kgSegunda        && <td className="proyeccion-td-num">{num(row.kgSegunda, 0)}</td>}
                        {visibleCols.cajas            && <td className="proyeccion-td-num">{num(row.cajas, 0)}</td>}
                        <td className="proyeccion-td-na">—</td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hasMore && (
                <div style={{ textAlign: 'center', padding: '0.75rem 0' }}>
                  <button className="btn btn-secondary" onClick={() => setPage(p => p + 1)}>
                    Ver más — {displayData.length - visible.length} restante{displayData.length - visible.length !== 1 ? 's' : ''}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Column visibility menu portal ─────────────────────────────────── */}
      {colMenu && (
        <ColMenu x={colMenu.x} y={colMenu.y} visibleCols={visibleCols} onToggle={toggleCol} onClose={() => setColMenu(null)} />
      )}

      {/* ── Column filter popover portal ──────────────────────────────────── */}
      {filterPopover && createPortal(
        <>
          <div className="sh-filter-backdrop" onClick={() => setFilterPopover(null)} />
          <div className="sh-filter-popover" style={{ left: Math.min(filterPopover.x, window.innerWidth - 220), top: filterPopover.y }}>
            {filterPopover.type === 'text' ? (
              <>
                <FiFilter size={13} className="sh-filter-icon" />
                <input autoFocus className="sh-filter-input" placeholder="Filtrar…"
                  value={colFilters[filterPopover.field]?.text || ''}
                  onChange={e => setColFilter(filterPopover.field, 'text', 'text', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') setFilterPopover(null); }}
                />
                {colFilters[filterPopover.field]?.text && (
                  <button className="sh-filter-clear" onClick={() => { setColFilter(filterPopover.field, 'text', 'text', ''); setFilterPopover(null); }}>
                    <FiX size={13} />
                  </button>
                )}
              </>
            ) : (
              <div className="sh-filter-range">
                <span className="sh-filter-range-label">De</span>
                <input className="sh-filter-input sh-filter-input-range"
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
                  <button className="sh-filter-clear" onClick={() => {
                    setColFilters(prev => { const { [filterPopover.field]: _, ...rest } = prev; return rest; });
                    setPage(1);
                    setFilterPopover(null);
                  }}>
                    <FiX size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
