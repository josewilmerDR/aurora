import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  FiPlus, FiDollarSign, FiFilter, FiX, FiSliders,
  FiMoreVertical, FiEdit2, FiTrash2, FiPackage,
} from 'react-icons/fi';
import Toast from '../../components/Toast';
import ConfirmModal from '../../components/ConfirmModal';
import IncomeForm from '../../components/finance/IncomeForm';
import { useApiFetch } from '../../hooks/useApiFetch';
import { formatMoney, formatNumber } from '../../lib/formatMoney';
import '../Siembra.css';
import '../SiembraHistorial.css';
import './finance.css';

// ── Tabla: configuración de columnas ─────────────────────────────────────────
const COLUMNS = [
  { key: 'fecha',     label: 'Fecha',       type: 'date'   },
  { key: 'comprador', label: 'Comprador',   type: 'text'   },
  { key: 'lote',      label: 'Lote',        type: 'text'   },
  { key: 'despachos', label: 'Despachos',   type: 'number' },
  { key: 'cantidad',  label: 'Cantidad',    type: 'number' },
  { key: 'unidad',    label: 'Unidad',      type: 'text'   },
  { key: 'precio',    label: 'P. unit.',    type: 'number' },
  { key: 'total',     label: 'Total',       type: 'number' },
  { key: 'moneda',    label: 'Moneda',      type: 'text'   },
  { key: 'estado',    label: 'Estado',      type: 'text'   },
  { key: 'fespera',   label: 'F. esperada', type: 'date'   },
  { key: 'fcobro',    label: 'F. cobrada',  type: 'date'   },
];

const ALL_COLS_VISIBLE = Object.fromEntries(COLUMNS.map(c => [c.key, true]));

const STATUS_PILL = {
  pendiente: { label: 'Pendiente', cls: 'finance-pill--pending' },
  cobrado:   { label: 'Cobrado',   cls: 'finance-pill--paid'    },
  anulado:   { label: 'Anulado',   cls: 'finance-pill--void'    },
};

const formatFecha = (iso) =>
  iso ? new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

function getColVal(r, key) {
  switch (key) {
    case 'fecha':     return r.date || '';
    case 'comprador': return (r.buyerName || '').toLowerCase();
    case 'lote':      return (r.loteNombre || '').toLowerCase();
    case 'despachos': return Array.isArray(r.despachoIds) ? r.despachoIds.length : 0;
    case 'cantidad':  return Number(r.quantity) || 0;
    case 'unidad':    return (r.unit || '').toLowerCase();
    case 'precio':    return Number(r.unitPrice) || 0;
    case 'total':     return Number(r.totalAmountCRC) || Number(r.totalAmount) || 0;
    case 'moneda':    return (r.currency || '').toLowerCase();
    case 'estado':    return (r.collectionStatus || '').toLowerCase();
    case 'fespera':   return r.expectedCollectionDate || '';
    case 'fcobro':    return r.actualCollectionDate || '';
    default:          return '';
  }
}

// ── Menú de columnas visibles ────────────────────────────────────────────────
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
    document.body,
  );
}

// ── Página principal ─────────────────────────────────────────────────────────
function IncomeRecords() {
  const apiFetch = useApiFetch();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const [sortField, setSortField] = useState('fecha');
  const [sortDir,   setSortDir]   = useState('desc');
  const [colFilters, setColFilters] = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [visibleCols, setVisibleCols] = useState(ALL_COLS_VISIBLE);
  const [colMenu, setColMenu] = useState(null);

  const [rowMenu, setRowMenu] = useState(null);
  const [rowMenuPos, setRowMenuPos] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (rowMenu === null) return;
    const close = () => setRowMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [rowMenu]);

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // ── Carga ─────────────────────────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/income')
      .then(r => r.json())
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(() => setToast({ type: 'error', message: 'No se pudo cargar el historial.' }))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // ── Handlers CRUD ────────────────────────────────────────────────────────
  const handleSave = async (payload) => {
    setSaving(true);
    const isEdit = Boolean(payload.id);
    const url = isEdit ? `/api/income/${payload.id}` : '/api/income';
    const method = isEdit ? 'PUT' : 'POST';
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al guardar.');
      }
      setToast({ type: 'success', message: isEdit ? 'Ingreso actualizado.' : 'Ingreso registrado.' });
      setShowForm(false);
      setEditing(null);
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await apiFetch(`/api/income/${confirmDelete}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar.');
      setToast({ type: 'success', message: 'Ingreso eliminado.' });
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setConfirmDelete(null);
    }
  };

  const startEdit = (record) => { setEditing(record); setShowForm(true); };
  const startCreate = () => { setEditing(null); setShowForm(true); };
  const cancel = () => { setShowForm(false); setEditing(null); };

  // ── Sort / filtros de columna ─────────────────────────────────────────────
  const handleThSort = (field) => {
    if (sortField !== field) { setSortField(field); setSortDir('desc'); }
    else if (sortDir === 'desc') { setSortDir('asc'); }
    else { setSortField(null); setSortDir(null); }
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
  };

  const toggleCol = (key) => setVisibleCols(prev => ({ ...prev, [key]: !prev[key] }));
  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu({ x: r.right - 185, y: r.bottom + 4 });
  };

  // ── Datos derivados ──────────────────────────────────────────────────────
  const displayData = useMemo(() => {
    let data = [...records];

    const activeColFilters = Object.entries(colFilters).filter(([, fv]) => {
      if (fv.text !== undefined) return fv.text.trim();
      return fv.from || fv.to;
    });
    if (activeColFilters.length > 0) {
      data = data.filter(r => {
        for (const [key, fv] of activeColFilters) {
          const col = COLUMNS.find(c => c.key === key);
          if (!col) continue;
          const val = getColVal(r, key);
          if (col.type === 'text') {
            if (fv.text && !String(val).includes(fv.text.toLowerCase())) return false;
          } else if (col.type === 'date') {
            if (!val) return false;
            if (fv.from && val < fv.from) return false;
            if (fv.to   && val > fv.to)   return false;
          } else if (col.type === 'number') {
            if (fv.from !== '' && fv.from !== undefined && Number(val) < Number(fv.from)) return false;
            if (fv.to   !== '' && fv.to   !== undefined && Number(val) > Number(fv.to))   return false;
          }
        }
        return true;
      });
    }

    if (sortField && sortDir) {
      data.sort((a, b) => {
        const av = getColVal(a, sortField);
        const bv = getColVal(b, sortField);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return data;
  }, [records, colFilters, sortField, sortDir]);

  // ── Stats (usan totalAmountCRC para agregación) ──────────────────────────
  const stats = useMemo(() => {
    const totalPendiente = displayData
      .filter(r => r.collectionStatus === 'pendiente')
      .reduce((s, r) => s + (Number(r.totalAmountCRC) || Number(r.totalAmount) || 0), 0);
    const totalCobrado = displayData
      .filter(r => r.collectionStatus === 'cobrado')
      .reduce((s, r) => s + (Number(r.totalAmountCRC) || Number(r.totalAmount) || 0), 0);
    return { totalPendiente, totalCobrado };
  }, [displayData]);

  // ── TH sortable ──────────────────────────────────────────────────────────
  const SortTh = ({ col, children }) => {
    const isSort  = sortField === col.key;
    const hasFilt = !!colFilters[col.key];
    if (!visibleCols[col.key]) return null;
    return (
      <th
        className={`sh-th-sortable${isSort ? ' is-sorted' : ''}${hasFilt ? ' has-col-filter' : ''}`}
        onClick={() => handleThSort(col.key)}
      >
        <span className="sh-th-content">
          {children}
          <span className="sh-th-arrow">{isSort ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
          <span
            className={`sh-th-funnel${hasFilt ? ' is-active' : ''}`}
            onClick={e => openColFilter(e, col.key, col.type)}
            title="Filtrar columna"
          >
            <FiFilter size={10} />
          </span>
        </span>
      </th>
    );
  };

  return (
    <div className="lote-page">
      <div className="lote-page-header">
        <h2 className="lote-page-title"><FiDollarSign /> Ingresos</h2>
        {!showForm && (
          <button className="btn btn-primary" onClick={startCreate}>
            <FiPlus /> Nuevo ingreso
          </button>
        )}
      </div>

      {showForm && (
        <IncomeForm
          initial={editing}
          onSubmit={handleSave}
          onCancel={cancel}
          saving={saving}
        />
      )}

      {!showForm && (
        loading ? (
          <p className="finance-empty">Cargando…</p>
        ) : records.length === 0 ? (
          <div className="siembra-empty-state">
            <FiPackage size={36} />
            <p>Aún no hay ingresos registrados.</p>
          </div>
        ) : (
          <>
            {/* ── Stats bar ──────────────────────────────────────────── */}
            <div className="sh-stats-bar">
              <div className="sh-stat">
                <span className="sh-stat-value">{displayData.length}</span>
                <span className="sh-stat-label">Registros</span>
              </div>
              <div className="sh-stat-divider" />
              <div className="sh-stat">
                <span className="sh-stat-value">{formatMoney(stats.totalPendiente)}</span>
                <span className="sh-stat-label">Pendiente</span>
              </div>
              <div className="sh-stat-divider sh-stat-hide-mobile" />
              <div className="sh-stat sh-stat-hide-mobile">
                <span className="sh-stat-value sh-stat-green">{formatMoney(stats.totalCobrado)}</span>
                <span className="sh-stat-label">Cobrado</span>
              </div>
            </div>

            {/* ── Tabla ──────────────────────────────────────────────── */}
            <div className="siembra-historial sh-table-card">
              <div className="historial-top-row">
                <span className="sh-result-count">
                  {displayData.length === records.length
                    ? `${records.length} registros`
                    : `${displayData.length} de ${records.length} registros`}
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
                        {COLUMNS.map(col => visibleCols[col.key] && (
                          <SortTh key={col.key} col={col}>{col.label}</SortTh>
                        ))}
                        <th className="sh-th-settings">
                          <button
                            className={`sh-col-toggle-btn${Object.values(visibleCols).some(v => !v) ? ' sh-col-toggle-btn--active' : ''}`}
                            onClick={handleColBtnClick}
                            title="Personalizar columnas"
                          >
                            <FiSliders size={12} />
                            {Object.values(visibleCols).filter(v => !v).length > 0 && (
                              <span className="sh-col-hidden-badge">{Object.values(visibleCols).filter(v => !v).length}</span>
                            )}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayData.map(r => {
                        const pill = STATUS_PILL[r.collectionStatus] || STATUS_PILL.pendiente;
                        const dispCount = Array.isArray(r.despachoIds) ? r.despachoIds.length : (r.despachoId ? 1 : 0);
                        return (
                          <tr key={r.id} className={r.collectionStatus === 'anulado' ? 'row-anulado' : ''}>
                            {visibleCols.fecha     && <td className="td-readonly">{formatFecha(r.date)}</td>}
                            {visibleCols.comprador && <td>{r.buyerName || '—'}</td>}
                            {visibleCols.lote      && <td>{r.loteNombre || '—'}</td>}
                            {visibleCols.despachos && <td className="td-num">{dispCount || '—'}</td>}
                            {visibleCols.cantidad  && <td className="td-num">{formatNumber(r.quantity)}</td>}
                            {visibleCols.unidad    && <td>{r.unit || '—'}</td>}
                            {visibleCols.precio    && <td className="td-num">{formatNumber(r.unitPrice, { decimals: 4 })}</td>}
                            {visibleCols.total     && <td className="td-num td-calc">{formatMoney(r.totalAmount, r.currency)}</td>}
                            {visibleCols.moneda    && <td>{r.currency || '—'}</td>}
                            {visibleCols.estado    && <td><span className={`finance-pill ${pill.cls}`}>{pill.label}</span></td>}
                            {visibleCols.fespera   && <td className="td-readonly">{formatFecha(r.expectedCollectionDate)}</td>}
                            {visibleCols.fcobro    && <td className="td-readonly">{formatFecha(r.actualCollectionDate)}</td>}
                            <td>
                              <div className="hist-kebab-wrap" onPointerDown={e => e.stopPropagation()}>
                                <button
                                  className="hist-kebab-btn"
                                  onClick={e => {
                                    if (rowMenu === r.id) { setRowMenu(null); return; }
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setRowMenuPos({
                                      top: rect.bottom + 4,
                                      right: window.innerWidth - rect.right,
                                    });
                                    setRowMenu(r.id);
                                  }}
                                >
                                  <FiMoreVertical size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )
      )}

      {/* ── Column visibility menu portal ───────────────────────────── */}
      {colMenu && (
        <ColMenu x={colMenu.x} y={colMenu.y} visibleCols={visibleCols} onToggle={toggleCol} onClose={() => setColMenu(null)} />
      )}

      {/* ── Column filter popover portal ────────────────────────────── */}
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
        document.body,
      )}

      {/* ── Kebab dropdown portal ───────────────────────────────────── */}
      {rowMenu !== null && (() => {
        const r = records.find(x => x.id === rowMenu);
        if (!r) return null;
        return createPortal(
          <div
            className="hist-kebab-dropdown hist-kebab-dropdown-fixed"
            style={{ top: rowMenuPos.top, right: rowMenuPos.right }}
            onPointerDown={e => e.stopPropagation()}
          >
            <button className="hist-kebab-item" onClick={() => { setRowMenu(null); startEdit(r); }}>
              <FiEdit2 size={13} />
              Editar
            </button>
            <button className="hist-kebab-item hist-kebab-item-danger" onClick={() => { setRowMenu(null); setConfirmDelete(r.id); }}>
              <FiTrash2 size={13} />
              Eliminar
            </button>
          </div>,
          document.body,
        );
      })()}

      {confirmDelete && (
        <ConfirmModal
          title="Eliminar ingreso"
          message="Esta acción no se puede deshacer."
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

export default IncomeRecords;
