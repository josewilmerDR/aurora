import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FiFilter, FiX, FiSliders, FiDollarSign } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import Toast from '../../../components/Toast';
import '../../../pages/Siembra.css';
import '../../../pages/SiembraHistorial.css';
import '../styles/cosecha-despachos.css';

// ── Column definitions ───────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'consecutivo', label: 'Consec.',      type: 'text'   },
  { key: 'fecha',       label: 'Fecha',        type: 'date'   },
  { key: 'lote',        label: 'Lote',         type: 'text'   },
  { key: 'operario',    label: 'Op. camión',   type: 'text'   },
  { key: 'placa',       label: 'Placa',        type: 'text'   },
  { key: 'cantidad',    label: 'Cantidad',     type: 'number' },
  { key: 'unidad',      label: 'Unidad',       type: 'text'   },
  { key: 'despachador', label: 'Despachador',  type: 'text'   },
  { key: 'encargado',   label: 'Encargado',    type: 'text'   },
  { key: 'boletas',     label: 'Boletas',      type: 'text'   },
  { key: 'nota',        label: 'Nota',         type: 'text'   },
  { key: 'estado',      label: 'Estado',       type: 'text'   },
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
const fmt = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
};

const num = (v) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return isNaN(n) ? '—' : n.toLocaleString('es-ES');
};

function getColVal(d, key) {
  switch (key) {
    case 'consecutivo': return (d.consecutivo || '').toLowerCase();
    case 'fecha':       return d.fecha?.slice(0, 10) || '';
    case 'lote':        return (d.loteNombre || '').toLowerCase();
    case 'operario':    return (d.operarioCamionNombre || '').toLowerCase();
    case 'placa':       return (d.placaCamion || '').toLowerCase();
    case 'cantidad':    return d.cantidad || 0;
    case 'unidad':      return (d.unidad || '').toLowerCase();
    case 'despachador': return (d.despachadorNombre || '').toLowerCase();
    case 'encargado':   return (d.encargadoNombre || '').toLowerCase();
    case 'boletas':     return (d.boletas?.map(b => b.consecutivo || '').join(', ') || '').toLowerCase();
    case 'nota':        return (d.nota || '').toLowerCase();
    case 'estado':      return (d.estado || '').toLowerCase();
    default:            return '';
  }
}

// ── Subcomponente: encabezado ordenable + filtro ────────────────────────────
function SortTh({ col, children, visibleCols, sortField, sortDir, colFilters, onSort, onFilter }) {
  if (!visibleCols[col.key]) return null;
  const isSort  = sortField === col.key;
  const hasFilt = !!colFilters[col.key];
  return (
    <th
      className={`sh-th-sortable${isSort ? ' is-sorted' : ''}${hasFilt ? ' has-col-filter' : ''}`}
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

// ── Main Component ───────────────────────────────────────────────────────────
export default function CosechaHistorialDespacho() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();

  const [despachos, setDespachos] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState(null);

  const [sortField, setSortField] = useState('fecha');
  const [sortDir,   setSortDir]   = useState('desc');
  const [colFilters, setColFilters] = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [visibleCols, setVisibleCols] = useState(ALL_COLS_VISIBLE);
  const [colMenu, setColMenu] = useState(null);

  // Despachos ya vinculados a un income_record — badge informativo.
  const [linkedDispatchIds, setLinkedDispatchIds] = useState(new Set());

  const toggleCol = (key) => setVisibleCols(prev => ({ ...prev, [key]: !prev[key] }));
  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu({ x: r.right - 185, y: r.bottom + 4 });
  };

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // ── Sort handler (3-state: desc → asc → none) ────────────────────────────
  const handleThSort = (field) => {
    if (sortField !== field) { setSortField(field); setSortDir('desc'); }
    else if (sortDir === 'desc') { setSortDir('asc'); }
    else { setSortField(null); setSortDir(null); }
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
  };

  // ── Carga ─────────────────────────────────────────────────────────────────
  const loadLinkedIncome = () => {
    apiFetch('/api/income')
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        const ids = new Set();
        for (const inc of data) {
          if (Array.isArray(inc.despachoIds)) {
            for (const d of inc.despachoIds) if (d?.id) ids.add(d.id);
          }
          if (inc.despachoId) ids.add(inc.despachoId);
        }
        setLinkedDispatchIds(ids);
      })
      .catch(() => {});
  };

  useEffect(() => {
    setLoading(true);
    apiFetch('/api/cosecha/despachos')
      .then(r => r.json())
      .then(data => setDespachos(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar el historial de despachos.', 'error'))
      .finally(() => setLoading(false));
    loadLinkedIncome();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtrado y ordenamiento ───────────────────────────────────────────────
  const displayData = useMemo(() => {
    let data = [...despachos];

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
  }, [despachos, colFilters, sortField, sortDir]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="sh-layout" style={{ padding: '1.5rem' }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Encabezado ──────────────────────────────────────────────────── */}
      <div className="ch-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="ch-title">Historial de Despachos</h1>
          <p className="ch-subtitle">
            {loading ? 'Cargando…' : `${displayData.length} despacho${displayData.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/cosecha/despacho')}>Nuevo Despacho</button>
      </div>

      {/* ── Tabla ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="empty-state"><p className="item-main-text">Cargando historial…</p></div>
      ) : despachos.length === 0 ? (
        <div className="empty-state">
          <p className="item-main-text">Sin despachos registrados</p>
          <p>Los despachos aparecen aquí una vez creados desde <strong>Despacho de Cosecha</strong>.</p>
        </div>
      ) : (
        <div className="sh-table-card">
          <div className="historial-top-row">
            <span className="sh-result-count">
              {displayData.length === despachos.length
                ? `${despachos.length} registros`
                : `${displayData.length} de ${despachos.length} registros`}
            </span>
            {Object.keys(colFilters).length > 0 && (
              <button className="sh-clear-col-filters" onClick={() => setColFilters({})}>
                <FiX size={11} /> Limpiar filtros de columna
              </button>
            )}
          </div>

          {displayData.length === 0 ? (
            <p className="empty-state">No hay registros con los filtros aplicados.</p>
          ) : (
            <div className="siembra-table-wrapper">
              <table className="siembra-table siembra-table-historial">
                <thead>
                  <tr>
                    {COLUMNS.map(col => (
                      <SortTh key={col.key} col={col}
                        visibleCols={visibleCols} sortField={sortField} sortDir={sortDir}
                        colFilters={colFilters} onSort={handleThSort} onFilter={openColFilter}
                      >{col.label}</SortTh>
                    ))}
                    <th className="sh-th-settings">
                      <button
                        className={`sh-col-toggle-btn${Object.values(visibleCols).some(v=>!v) ? ' sh-col-toggle-btn--active' : ''}`}
                        onClick={handleColBtnClick}
                        title="Personalizar columnas"
                      >
                        <FiSliders size={12} />
                        {Object.values(visibleCols).filter(v=>!v).length > 0 && (
                          <span className="sh-col-hidden-badge">{Object.values(visibleCols).filter(v=>!v).length}</span>
                        )}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayData.map(d => {
                    const alreadyLinked = linkedDispatchIds.has(d.id);
                    return (
                    <tr key={d.id} className={d.estado === 'anulado' ? 'dsp-item--anulado' : ''}>
                      {visibleCols.consecutivo && <td style={{ fontFamily: 'monospace', color: 'var(--aurora-green)', whiteSpace: 'nowrap' }}>{d.consecutivo || '—'}</td>}
                      {visibleCols.fecha       && <td style={{ whiteSpace: 'nowrap' }}>{fmt(d.fecha)}</td>}
                      {visibleCols.lote        && <td>{d.loteNombre           || '—'}</td>}
                      {visibleCols.operario    && <td>{d.operarioCamionNombre || '—'}</td>}
                      {visibleCols.placa       && <td>{d.placaCamion          || '—'}</td>}
                      {visibleCols.cantidad    && <td className="td-num">{num(d.cantidad)}</td>}
                      {visibleCols.unidad      && <td>{d.unidad               || '—'}</td>}
                      {visibleCols.despachador && <td>{d.despachadorNombre    || '—'}</td>}
                      {visibleCols.encargado   && <td>{d.encargadoNombre      || '—'}</td>}
                      {visibleCols.boletas     && <td>{d.boletas?.length ? d.boletas.map(b => b.consecutivo || '?').join(', ') : '—'}</td>}
                      {visibleCols.nota        && <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#8ba5bf' }} title={d.nota || ''}>{d.nota || '—'}</td>}
                      {visibleCols.estado      && <td>
                        {d.estado === 'anulado'
                          ? <span className="dsp-badge dsp-badge--anulado">Anulado</span>
                          : <span className="dsp-badge dsp-badge--activo">Activo</span>}
                      </td>}
                      <td>
                        {alreadyLinked && (
                          <span className="dsp-income-linked" title="Este despacho ya tiene un ingreso registrado">
                            <FiDollarSign size={12} /> Ingreso registrado
                          </span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
          <div className="sh-filter-popover" style={{ left: filterPopover.x, top: filterPopover.y }}>
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
                  <button className="sh-filter-clear" onClick={() => { setColFilter(filterPopover.field, filterPopover.type, 'from', ''); setColFilter(filterPopover.field, filterPopover.type, 'to', ''); setFilterPopover(null); }}>
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
