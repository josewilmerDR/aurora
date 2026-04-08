import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  FiClipboard, FiEdit, FiTrash2, FiFilter, FiSliders, FiX, FiPlus,
} from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './Horimetro.css';

const COLUMNS = [
  { id: 'fecha',            label: 'Fecha',             filterType: 'date'   },
  { id: 'tractorNombre',    label: 'Tractor'                                  },
  { id: 'implemento',       label: 'Implemento'                               },
  { id: 'horimetroInicial', label: 'Horímetro Inicial', filterType: 'number' },
  { id: 'horimetroFinal',   label: 'Horímetro Final',   filterType: 'number' },
  { id: 'horas',            label: 'Horas',             plain: true           },
  { id: 'loteNombre',       label: 'Lote'                                     },
  { id: 'grupo',            label: 'Grupo'                                    },
  { id: 'bloque',           label: 'Bloque',            plain: true           },
  { id: 'labor',            label: 'Labor'                                    },
  { id: 'horaInicio',       label: 'Hora Inicial'                             },
  { id: 'horaFinal',        label: 'Hora Final'                               },
  { id: 'operarioNombre',   label: 'Operario'                                 },
];

function compare(a, b, field) {
  const av = a[field] ?? '';
  const bv = b[field] ?? '';
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
}

function multiSort(records, sorts) {
  const active = sorts.filter(s => s.field);
  if (!active.length) return [...records];
  return [...records].sort((a, b) => {
    for (const s of active) {
      const r = compare(a, b, s.field);
      if (r !== 0) return s.dir === 'desc' ? -r : r;
    }
    return 0;
  });
}

function horasUsadas(rec) {
  const ini = parseFloat(rec.horimetroInicial);
  const fin = parseFloat(rec.horimetroFinal);
  if (!isNaN(ini) && !isNaN(fin) && fin >= ini) return (fin - ini).toFixed(1);
  return null;
}

function HistorialHorimetros() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const [colFilters,    setColFilters]    = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [hiddenCols,    setHiddenCols]    = useState(new Set());
  const [colMenu,       setColMenu]       = useState(null);
  const [sorts, setSorts] = useState([{ field: 'fecha', dir: 'desc' }]);

  const fetchRecords = () =>
    apiFetch('/api/horimetro')
      .then(r => r.json())
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar los registros.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => { fetchRecords(); }, []);

  const handleEdit = (rec) => {
    navigate('/operaciones/horimetro/registro', { state: { editRecord: rec } });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este registro de horímetro?')) return;
    try {
      const res = await apiFetch(`/api/horimetro/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Registro eliminado.');
      fetchRecords();
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const activeCol = Object.entries(colFilters).filter(([, f]) => {
      if (!f) return false;
      if (f.type === 'range') return !!(f.from?.trim() || f.to?.trim());
      return !!f.value?.trim();
    });
    return records.filter(r => {
      for (const [field, filter] of activeCol) {
        const cell = r[field];
        if (filter.type === 'range') {
          if (cell == null || cell === '') return false;
          const num = Number(cell);
          if (!isNaN(num) && cell !== '') {
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
  }, [records, colFilters]);

  const sorted = useMemo(() => multiSort(filtered, sorts), [filtered, sorts]);

  const handleThSort = (field) => {
    setSorts(prev => {
      const next = [...prev];
      next[0] = next[0].field === field
        ? { field, dir: next[0].dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' };
      return next;
    });
  };

  const openFilter = (e, field, filterType = 'text') => {
    e.stopPropagation();
    if (filterPopover?.field === field) { setFilterPopover(null); return; }
    const th   = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    setFilterPopover({ field, x: rect.left, y: rect.bottom + 4, filterType });
  };

  const openColMenu = (e) => {
    e.preventDefault();
    setColMenu({ x: e.clientX, y: e.clientY });
  };

  const toggleCol = (id) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const hiddenCount = hiddenCols.size;

  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu(prev => prev ? null : { x: r.right - 190, y: r.bottom + 4 });
  };

  const setColFilter = (field, filterObj) => {
    const empty = !filterObj ||
      (filterObj.type === 'range' ? !filterObj.from?.trim() && !filterObj.to?.trim() : !filterObj.value?.trim());
    setColFilters(prev => empty
      ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field))
      : { ...prev, [field]: filterObj }
    );
  };

  // ── Sort+filter column header ──────────────────────────────────────────────
  const SortTh = ({ field, children, filterType = 'text' }) => {
    const active = sorts[0].field === field;
    const dir    = active ? sorts[0].dir : null;
    const f      = colFilters[field];
    const hasFilter = f
      ? (f.type === 'range' ? !!(f.from?.trim() || f.to?.trim()) : !!f.value?.trim())
      : false;
    return (
      <th
        className={`historial-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-col-filter' : ''}`}
        onClick={() => handleThSort(field)}
      >
        {children}
        <span className="historial-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        <span className={`historial-th-funnel${hasFilter ? ' is-active' : ''}`} onClick={e => openFilter(e, field, filterType)} title="Filtrar columna">
          <FiFilter size={10} />
        </span>
      </th>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="hor-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {loading ? (
        <div className="hor-page-loading" />
      ) : records.length === 0 ? (
        <div className="hor-empty-state">
          <FiClipboard size={36} />
          <p>No hay registros aún.</p>
          <button className="btn btn-primary" onClick={() => navigate('/operaciones/horimetro/registro')}>
            <FiPlus size={14} /> Crear el primero
          </button>
        </div>
      ) : (
        <>
          <div className="hor-toolbar">
            <h1 className="hor-page-title">Historial de Horímetros</h1>
            <button className="btn btn-primary" onClick={() => navigate('/operaciones/horimetro/registro')}>
              <FiPlus size={15} /> Nuevo Registro
            </button>
          </div>

          <section className="hor-section">
            <div className="hor-section-header">
              {Object.values(colFilters).some(f => f && (f.type === 'range' ? f.from?.trim() || f.to?.trim() : f.value?.trim())) && (
                <button className="historial-clear-col-filters" onClick={() => setColFilters({})}>
                  <FiX size={11} />
                  Limpiar filtros de columna
                </button>
              )}
            </div>

            {sorted.length === 0 ? (
              <div className="hor-empty-state">
                <FiClipboard size={36} />
                <p>Sin resultados para los filtros activos.</p>
              </div>
            ) : (
              <div className="hor-table-wrap">
                <table className="hor-table">
                  <thead>
                    <tr onContextMenu={openColMenu}>
                      {COLUMNS.map(col => hiddenCols.has(col.id) ? null : col.plain
                        ? <th key={col.id}>{col.label}</th>
                        : <SortTh key={col.id} field={col.id} filterType={col.filterType}>{col.label}</SortTh>
                      )}
                      <th className="hor-th-settings">
                        <button
                          className={`hor-col-toggle-btn${hiddenCount > 0 ? ' hor-col-toggle-btn--active' : ''}`}
                          onClick={handleColBtnClick}
                          title="Personalizar columnas visibles"
                        >
                          <FiSliders size={12} />
                          {hiddenCount > 0 && <span className="hor-col-hidden-badge">{hiddenCount}</span>}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(rec => {
                      const hrs = horasUsadas(rec);
                      return (
                        <tr key={rec.id}>
                          {!hiddenCols.has('fecha')            && <td className="hor-td-date">{rec.fecha || '—'}</td>}
                          {!hiddenCols.has('tractorNombre')    && <td className="hor-td-maq">{rec.tractorNombre || '—'}</td>}
                          {!hiddenCols.has('implemento')       && <td>{rec.implemento || <span className="hor-td-empty">—</span>}</td>}
                          {!hiddenCols.has('horimetroInicial') && <td className="hor-td-num">{rec.horimetroInicial !== '' && rec.horimetroInicial != null ? rec.horimetroInicial : <span className="hor-td-empty">—</span>}</td>}
                          {!hiddenCols.has('horimetroFinal')   && <td className="hor-td-num">{rec.horimetroFinal   !== '' && rec.horimetroFinal   != null ? rec.horimetroFinal   : <span className="hor-td-empty">—</span>}</td>}
                          {!hiddenCols.has('horas')            && <td className={`hor-td-horas${hrs ? '' : ' hor-td-empty'}`}>{hrs ?? '—'}</td>}
                          {!hiddenCols.has('loteNombre')       && <td>{rec.loteNombre || <span className="hor-td-empty">—</span>}</td>}
                          {!hiddenCols.has('grupo')            && <td>{rec.grupo      || <span className="hor-td-empty">—</span>}</td>}
                          {!hiddenCols.has('bloque')           && <td>{rec.bloques?.length ? rec.bloques.join(', ') : (rec.bloque || <span className="hor-td-empty">—</span>)}</td>}
                          {!hiddenCols.has('labor')            && <td className="hor-td-labor">{rec.labor || <span className="hor-td-empty">—</span>}</td>}
                          {!hiddenCols.has('horaInicio')       && <td className="hor-td-time">{rec.horaInicio || '—'}</td>}
                          {!hiddenCols.has('horaFinal')        && <td className="hor-td-time">{rec.horaFinal  || '—'}</td>}
                          {!hiddenCols.has('operarioNombre')   && <td>{rec.operarioNombre || <span className="hor-td-empty">—</span>}</td>}
                          <td className="hor-td-actions">
                            <button className="hor-btn-icon" onClick={() => handleEdit(rec)} title="Editar">
                              <FiEdit size={13} />
                            </button>
                            <button className="hor-btn-icon hor-btn-danger" onClick={() => handleDelete(rec.id)} title="Eliminar">
                              <FiTrash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>

    {filterPopover && createPortal(
      <>
        <div className="historial-filter-backdrop" onClick={() => setFilterPopover(null)} />
        <div
          className={`historial-filter-popover${filterPopover.filterType !== 'text' ? ' historial-filter-popover--range' : ''}`}
          style={{ left: filterPopover.x, top: filterPopover.y }}
        >
          <FiFilter size={13} className="historial-filter-popover-icon" />
          {filterPopover.filterType !== 'text' ? (
            <>
              <div className="historial-filter-range">
                <div className="historial-filter-range-row">
                  <span className="historial-filter-range-label">De</span>
                  <input
                    autoFocus
                    type={filterPopover.filterType}
                    className="historial-filter-input"
                    value={colFilters[filterPopover.field]?.from || ''}
                    onChange={e => setColFilter(filterPopover.field, {
                      type: 'range',
                      from: e.target.value,
                      to: colFilters[filterPopover.field]?.to || '',
                    })}
                    onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
                  />
                </div>
                <div className="historial-filter-range-row">
                  <span className="historial-filter-range-label">A</span>
                  <input
                    type={filterPopover.filterType}
                    className="historial-filter-input"
                    value={colFilters[filterPopover.field]?.to || ''}
                    onChange={e => setColFilter(filterPopover.field, {
                      type: 'range',
                      from: colFilters[filterPopover.field]?.from || '',
                      to: e.target.value,
                    })}
                    onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
                  />
                </div>
              </div>
              {(colFilters[filterPopover.field]?.from || colFilters[filterPopover.field]?.to) && (
                <button className="historial-filter-clear" title="Limpiar filtro" onClick={() => { setColFilter(filterPopover.field, null); setFilterPopover(null); }}>
                  <FiX size={13} />
                </button>
              )}
            </>
          ) : (
            <>
              <input
                autoFocus
                className="historial-filter-input"
                placeholder="Filtrar…"
                value={colFilters[filterPopover.field]?.value || ''}
                onChange={e => setColFilter(filterPopover.field, { type: 'text', value: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setFilterPopover(null); }}
              />
              {colFilters[filterPopover.field]?.value && (
                <button className="historial-filter-clear" title="Limpiar filtro" onClick={() => { setColFilter(filterPopover.field, null); setFilterPopover(null); }}>
                  <FiX size={13} />
                </button>
              )}
            </>
          )}
        </div>
      </>,
      document.body
    )}

    {colMenu && createPortal(
      <>
        <div className="hor-col-menu-backdrop" onClick={() => setColMenu(null)} />
        <div className="hor-col-menu" style={{ left: colMenu.x, top: colMenu.y }}>
          <div className="hor-col-menu-title">Columnas visibles</div>
          {COLUMNS.map(col => (
            <button
              key={col.id}
              className={`hor-col-menu-item${hiddenCols.has(col.id) ? ' is-hidden' : ''}`}
              onClick={() => toggleCol(col.id)}
            >
              <span className="hor-col-menu-check" />
              {col.label}
            </button>
          ))}
          {hiddenCols.size > 0 && (
            <button className="hor-col-menu-reset" onClick={() => { setHiddenCols(new Set()); setColMenu(null); }}>
              Mostrar todas
            </button>
          )}
        </div>
      </>,
      document.body
    )}
    </>
  );
}

export default HistorialHorimetros;
