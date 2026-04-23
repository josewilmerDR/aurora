import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FiFilter, FiX, FiSliders } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import Toast from '../../../components/Toast';
import '../../../pages/Siembra.css';
import '../../../pages/SiembraHistorial.css';
import '../styles/cosecha-historial.css';

// ── Column definitions ───────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'consecutivo',    label: 'Consec.',     type: 'text'   },
  { key: 'fecha',          label: 'Fecha',       type: 'date'   },
  { key: 'lote',           label: 'Lote',        type: 'text'   },
  { key: 'grupo',          label: 'Grupo',       type: 'text'   },
  { key: 'bloque',         label: 'Bloque',      type: 'text'   },
  { key: 'cantidad',       label: 'Cant. campo', type: 'number' },
  { key: 'unidad',         label: 'Unidad',      type: 'text'   },
  { key: 'operario',       label: 'Operario',    type: 'text'   },
  { key: 'activo',         label: 'Activo',      type: 'text'   },
  { key: 'implemento',     label: 'Implemento',  type: 'text'   },
  { key: 'nota',           label: 'Nota',        type: 'text'   },
  { key: 'recibido',       label: 'Recibido planta', type: 'number' },
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

function getColVal(r, key) {
  switch (key) {
    case 'consecutivo': return (r.consecutivo || '').toLowerCase();
    case 'fecha':       return r.fecha?.slice(0, 10) || '';
    case 'lote':        return (r.loteNombre || '').toLowerCase();
    case 'grupo':       return (r.grupo || '').toLowerCase();
    case 'bloque':      return (r.bloque || '').toLowerCase();
    case 'cantidad':    return r.cantidad || 0;
    case 'unidad':      return (r.unidad || '').toLowerCase();
    case 'operario':    return (r.operarioNombre || '').toLowerCase();
    case 'activo':      return (r.activoNombre || '').toLowerCase();
    case 'implemento':  return (r.implementoNombre || '').toLowerCase();
    case 'nota':        return (r.nota || '').toLowerCase();
    case 'recibido':    return r.cantidadRecibidaPlanta || 0;
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

// ── Nota cell with "show more / show less" ──────────────────────────────────
function NotaCell({ text }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped]   = useState(false);
  const textRef = useRef(null);

  useEffect(() => {
    const el = textRef.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  if (!text) return <span style={{ color: '#8ba5bf' }}>—</span>;

  return (
    <span className="td-nota-wrap">
      <span ref={textRef} className={`td-nota-text${expanded ? ' td-nota-text--open' : ''}`}>
        {text}
      </span>
      {(clamped || expanded) && (
        <button className="td-nota-toggle" onClick={() => setExpanded(p => !p)}>
          {expanded ? 'ver menos' : 'ver más'}
        </button>
      )}
    </span>
  );
}

// ── Inline-editable cell for cantidadRecibidaPlanta ──────────────────────────
function InlineRecibido({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [val, setVal]         = useState('');
  const inputRef              = useRef(null);

  const open   = () => { setVal(value ?? ''); setEditing(true); };
  const cancel = () => setEditing(false);
  const save   = async () => {
    if (saving) return;
    setSaving(true);
    try { await onSave(val); } finally { setSaving(false); setEditing(false); }
  };

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <span className="ch-inline-edit">
        <input
          ref={inputRef}
          type="number"
          min="0"
          step="0.01"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          className="ch-inline-input"
          disabled={saving}
        />
        <button className="ch-inline-ok"     onClick={save}   title="Guardar" disabled={saving}>✓</button>
        <button className="ch-inline-cancel" onClick={cancel} title="Cancelar" disabled={saving}>✕</button>
      </span>
    );
  }

  return (
    <span
      className={`ch-inline-value${value != null && value !== '' ? '' : ' ch-inline-pending'}`}
      onClick={open}
      title="Clic para ingresar el valor recibido en planta"
    >
      {value != null && value !== '' ? num(value) : 'Pendiente'}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function CosechaHistorial() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();

  const [registros, setRegistros] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState(null);

  const [sortField, setSortField] = useState('fecha');
  const [sortDir,   setSortDir]   = useState('desc');
  const [colFilters, setColFilters] = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [visibleCols, setVisibleCols] = useState(ALL_COLS_VISIBLE);
  const [colMenu, setColMenu] = useState(null);

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
  const fetchRegistros = () => {
    setLoading(true);
    apiFetch('/api/cosecha/registros')
      .then(r => r.json())
      .then(data => setRegistros(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar el historial.', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRegistros(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Inline update of "recibido en planta" ─────────────────────────────────
  const handleRecibido = async (reg, rawVal) => {
    const parsed = rawVal !== '' ? parseFloat(rawVal) : null;
    const cantidadRecibidaPlanta = parsed != null && !isNaN(parsed) ? parsed : null;
    try {
      const res = await apiFetch(`/api/cosecha/registros/${reg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cantidadRecibidaPlanta }),
      });
      if (!res.ok) throw new Error();
      setRegistros(prev =>
        prev.map(r => r.id === reg.id ? { ...r, cantidadRecibidaPlanta } : r)
      );
      showToast('Cantidad recibida en planta actualizada.');
    } catch {
      showToast('Error al guardar.', 'error');
    }
  };

  // ── Filtrado y ordenamiento ───────────────────────────────────────────────
  const displayData = useMemo(() => {
    let data = [...registros];

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
  }, [registros, colFilters, sortField, sortDir]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="sh-layout cosecha-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Encabezado ──────────────────────────────────────────────────── */}
      <div className="ch-header">
        <div>
          <h1 className="ch-title">Historial de Cosecha</h1>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/cosecha/registro')}>Nuevo Registro</button>
      </div>

      {/* ── Tabla ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="empty-state"><p className="item-main-text">Cargando historial…</p></div>
      ) : registros.length === 0 ? (
        <div className="empty-state">
          <p className="item-main-text">Sin registros de cosecha</p>
          <p>Los registros aparecen aquí una vez creados desde <strong>Registro de Cosecha</strong>.</p>
        </div>
      ) : (
        <div className="sh-table-card">
          <div className="historial-top-row">
            <span className="sh-result-count">
              {displayData.length === registros.length
                ? `${registros.length} registros`
                : `${displayData.length} de ${registros.length} registros`}
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
                  {displayData.map(reg => (
                    <tr key={reg.id}>
                      {visibleCols.consecutivo && <td style={{ fontFamily: 'monospace', color: 'var(--aurora-green)', whiteSpace: 'nowrap' }}>{reg.consecutivo || '—'}</td>}
                      {visibleCols.fecha       && <td style={{ whiteSpace: 'nowrap' }}>{fmt(reg.fecha)}</td>}
                      {visibleCols.lote        && <td>{reg.loteNombre      || '—'}</td>}
                      {visibleCols.grupo       && <td>{reg.grupo           || '—'}</td>}
                      {visibleCols.bloque      && <td>{reg.bloque          || '—'}</td>}
                      {visibleCols.cantidad    && <td className="td-num">{num(reg.cantidad)}</td>}
                      {visibleCols.unidad      && <td>{reg.unidad          || '—'}</td>}
                      {visibleCols.operario    && <td>{reg.operarioNombre  || '—'}</td>}
                      {visibleCols.activo      && <td>{reg.activoNombre    || '—'}</td>}
                      {visibleCols.implemento  && <td>{reg.implementoNombre || '—'}</td>}
                      {visibleCols.nota        && <td className="td-nota"><NotaCell text={reg.nota} /></td>}
                      {visibleCols.recibido    && <td>
                        <InlineRecibido
                          value={reg.cantidadRecibidaPlanta}
                          onSave={(v) => handleRecibido(reg, v)}
                        />
                      </td>}
                      <td />
                    </tr>
                  ))}
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
