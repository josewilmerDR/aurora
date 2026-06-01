import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiPlus, FiDollarSign, FiFilter, FiX, FiSliders,
  FiMoreVertical, FiEdit2, FiTrash2, FiSearch,
  FiLayout, FiDownload, FiAlertTriangle, FiRefreshCw,
} from 'react-icons/fi';
import { useToast } from '../../../contexts/ToastContext';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraSkeleton from '../../../components/ui/AuroraSkeleton';
import IncomeForm from '../components/IncomeForm';
import { ColMenu, ColFilterPopover, RowKebabMenu } from '../components/table/SortableTable';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useTableColumnPreset } from '../../../hooks/useTableColumnPreset';
import { translateApiError } from '../../../lib/errorMessages';
import { formatMoney, formatNumber, formatPrice } from '../../../lib/formatMoney';
import { formatShortDate } from '../../../lib/formatDate';
import '../../planting/styles/siembra.css';
import '../../planting/styles/siembra-historial.css';
import '../styles/finance.css';

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

// `useTableColumnPreset` indexa por `id`; lo derivamos de `key`.
const COLUMN_DEFS = COLUMNS.map(c => ({ id: c.key, ...c }));
// Preset compacto (audit UX): la vista de 12 columnas abruma al usuario casual.
const COMPACT_KEYS = ['fecha', 'comprador', 'lote', 'total', 'estado'];

const STATUS_BADGE_VARIANT = {
  pendiente: { label: 'Pendiente', cls: 'aur-badge--magenta' },
  cobrado:   { label: 'Cobrado',   cls: 'aur-badge--green' },
  anulado:   { label: 'Anulado',   cls: 'aur-badge--gray' },
};

const dispatchCount = (r) =>
  Array.isArray(r.despachoIds) ? r.despachoIds.length : (r.despachoId ? 1 : 0);

// getColVal devuelve el valor que se ORDENA y FILTRA. Las fechas se recortan a
// `YYYY-MM-DD`: si el doc trae componente de hora, la comparación lexicográfica
// del filtro de rango excluía el día exacto del límite "A" (audit #20).
function getColVal(r, key) {
  switch (key) {
    case 'fecha':     return (r.date || '').slice(0, 10);
    case 'comprador': return (r.buyerName || '').toLowerCase();
    case 'lote':      return (r.loteNombre || '').toLowerCase();
    case 'despachos': return dispatchCount(r);
    case 'cantidad':  return Number(r.quantity) || 0;
    case 'unidad':    return (r.unit || '').toLowerCase();
    case 'precio':    return Number(r.unitPrice) || 0;
    case 'total':     return Number(r.totalAmountCRC) || Number(r.totalAmount) || 0;
    case 'moneda':    return (r.currency || '').toLowerCase();
    case 'estado':    return (r.collectionStatus || '').toLowerCase();
    case 'fespera':   return (r.expectedCollectionDate || '').slice(0, 10);
    case 'fcobro':    return (r.actualCollectionDate || '').slice(0, 10);
    default:          return '';
  }
}

// Valor crudo para el CSV (sin normalizar a minúsculas/CRC; eso lo agrega la
// columna "Total (CRC)" aparte).
function csvCellValue(r, key) {
  switch (key) {
    case 'fecha':     return r.date || '';
    case 'comprador': return r.buyerName || '';
    case 'lote':      return r.loteNombre || '';
    case 'despachos': return dispatchCount(r);
    case 'cantidad':  return r.quantity ?? '';
    case 'unidad':    return r.unit || '';
    case 'precio':    return r.unitPrice ?? '';
    case 'total':     return r.totalAmount ?? '';
    case 'moneda':    return r.currency || '';
    case 'estado':    return r.collectionStatus || '';
    case 'fespera':   return r.expectedCollectionDate || '';
    case 'fcobro':    return r.actualCollectionDate || '';
    default:          return '';
  }
}

// Extrae el mensaje en español del cuerpo de error del backend, con fallback.
async function apiErrorMessage(res, fallback) {
  const body = await res.json().catch(() => null);
  return translateApiError(body, fallback);
}

// ── TH ordenable (hoisteado a módulo: evita remount de todo el header en cada
//    tecla tipeada en la búsqueda — audit #16) ───────────────────────────────
function SortTh({ col, sortField, sortDir, hasFilter, onSort, onOpenFilter }) {
  const isSort = sortField === col.key;
  return (
    <th
      className={`sh-th-sortable${isSort ? ' is-sorted' : ''}${hasFilter ? ' has-col-filter' : ''}`}
      aria-sort={isSort ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
      tabIndex={0}
      onClick={() => onSort(col.key)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(col.key); } }}
    >
      <span className="sh-th-content">
        {col.label}
        <span className="sh-th-arrow" aria-hidden="true">{isSort ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
        <button
          type="button"
          className={`sh-th-funnel aur-touch-target${hasFilter ? ' is-active' : ''}`}
          aria-label={`Filtrar por ${col.label}${hasFilter ? ' (filtro activo)' : ''}`}
          title={`Filtrar por ${col.label}`}
          onClick={e => onOpenFilter(e, col.key, col.type)}
          onKeyDown={e => e.stopPropagation()}
        >
          <FiFilter size={13} />
        </button>
      </span>
    </th>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────
function IncomeRecords() {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // registro completo
  const [deleting, setDeleting] = useState(false);
  const [recentId, setRecentId] = useState(null); // highlight de fila recién tocada

  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('fecha');
  const [sortDir,   setSortDir]   = useState('desc');
  const [colFilters, setColFilters] = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [colMenu, setColMenu] = useState(null);

  // Visibilidad de columnas con preset compacto/completo persistido.
  const { visibleColumns, isVisible, toggleColumn, isCompact, setMode } =
    useTableColumnPreset(COLUMN_DEFS, COMPACT_KEYS, 'aurora_income_columns');
  const visibleColsMap = useMemo(
    () => Object.fromEntries(COLUMNS.map(c => [c.key, isVisible(c.key)])),
    [isVisible]
  );
  const hiddenCount = COLUMNS.length - visibleColumns.length;

  const [rowMenu, setRowMenu] = useState(null);
  const [rowMenuPos, setRowMenuPos] = useState({ top: 0, right: 0 });

  // Cierra el kebab al hacer click fuera.
  useEffect(() => {
    if (rowMenu === null) return;
    const close = () => setRowMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [rowMenu]);

  // Los overlays porteados (menú de columnas, popover de filtro, kebab) se
  // posicionan con coordenadas fixed calculadas al abrir; si el usuario
  // scrollea o rota el dispositivo quedarían flotando despegados de su ancla.
  // Los cerramos ante scroll/resize (audit #7).
  useEffect(() => {
    if (!colMenu && !filterPopover && rowMenu === null) return;
    const close = () => { setColMenu(null); setFilterPopover(null); setRowMenu(null); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [colMenu, filterPopover, rowMenu]);

  // Limpia el highlight de la fila recién tocada tras un par de segundos.
  useEffect(() => {
    if (!recentId) return;
    const t = setTimeout(() => setRecentId(null), 2000);
    return () => clearTimeout(t);
  }, [recentId]);

  // ── Carga ─────────────────────────────────────────────────────────────────
  // load(silent): el primer load muestra el skeleton; los refrescos posteriores
  // (tras guardar) son silenciosos para no desmontar la tabla y provocar flash.
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    apiFetch('/api/income')
      .then(async (r) => {
        if (!r.ok) {
          setRecords([]);
          setLoadError(await apiErrorMessage(r, 'No se pudo cargar el historial de ingresos.'));
          return;
        }
        const data = await r.json();
        setRecords(Array.isArray(data) ? data : []);
      })
      .catch(() => setLoadError('No se pudo cargar el historial de ingresos. Revisá tu conexión.'))
      .finally(() => { if (!silent) setLoading(false); });
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // ── Handlers CRUD ────────────────────────────────────────────────────────
  const handleSave = async (payload) => {
    setSaving(true);
    const isEdit = Boolean(payload.id);
    const url = isEdit ? `/api/income/${payload.id}` : '/api/income';
    const method = isEdit ? 'PUT' : 'POST';
    const { id: _omit, ...createBody } = payload; // no mandar id en el body del POST (#22)
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? payload : createBody),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'No se pudo guardar el ingreso.'));
      const out = await res.json().catch(() => ({}));
      toast.success(isEdit ? 'Ingreso actualizado.' : 'Ingreso registrado.');
      setRecentId(out.id || payload.id || null);
      setShowForm(false);
      setEditing(null);
      load(true);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/income/${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'No se pudo eliminar el ingreso.'));
      toast.success('Ingreso eliminado.');
      setRecords(prev => prev.filter(r => r.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
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

  const clearColFilter = (field, type) => {
    if (type === 'text') setColFilter(field, type, 'text', '');
    else { setColFilter(field, type, 'from', ''); setColFilter(field, type, 'to', ''); }
  };

  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    // Clamp al viewport: con 185px de ancho estimado el menú no se sale por la
    // izquierda en pantallas angostas (audit #18).
    const x = Math.max(8, Math.min(r.right - 185, window.innerWidth - 193));
    setColMenu({ x, y: r.bottom + 4 });
  };

  // ── Datos derivados ──────────────────────────────────────────────────────
  const displayData = useMemo(() => {
    let data = [...records];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      data = data.filter(r => [r.buyerName, r.loteNombre, r.unit, r.currency, r.collectionStatus]
        .some(v => v && String(v).toLowerCase().includes(q)));
    }

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
  }, [records, searchQuery, colFilters, sortField, sortDir]);

  const exportCSV = useCallback(() => {
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    // Insertamos "Total (CRC)" justo después de "Total": el CSV en moneda
    // original no se puede sumar mezclando CRC/USD; esta columna da el
    // equivalente normalizado que usan los stats (audit #14).
    const headerCells = [];
    COLUMNS.forEach(c => {
      headerCells.push(escape(c.label));
      if (c.key === 'total') headerCells.push(escape('Total (CRC)'));
    });
    const rows = displayData.map(r => {
      const cells = [];
      COLUMNS.forEach(col => {
        cells.push(escape(csvCellValue(r, col.key)));
        if (col.key === 'total') cells.push(escape(r.totalAmountCRC ?? r.totalAmount ?? ''));
      });
      return cells;
    });
    const csv = [headerCells, ...rows].map(row => row.join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ingresos_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [displayData]);

  // ── Stats (agregan en CRC vía totalAmountCRC) ─────────────────────────────
  const stats = useMemo(() => {
    const totalPendiente = displayData
      .filter(r => r.collectionStatus === 'pendiente')
      .reduce((s, r) => s + (Number(r.totalAmountCRC) || Number(r.totalAmount) || 0), 0);
    const totalCobrado = displayData
      .filter(r => r.collectionStatus === 'cobrado')
      .reduce((s, r) => s + (Number(r.totalAmountCRC) || Number(r.totalAmount) || 0), 0);
    return { totalPendiente, totalCobrado };
  }, [displayData]);

  const filtersActive = Object.keys(colFilters).length > 0 || Boolean(searchQuery);

  return (
    <div className="lote-page">
      <div className="lote-page-header">
        <h2 className="lote-page-title"><FiDollarSign /> Ingresos</h2>
        {!showForm && (
          <button className="aur-btn-pill" onClick={startCreate}>
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
        loadError ? (
          <div className="siembra-empty-state" role="alert">
            <FiAlertTriangle size={36} />
            <p>{loadError}</p>
            <button className="aur-btn-pill" onClick={() => load()}>
              <FiRefreshCw /> Reintentar
            </button>
          </div>
        ) : loading ? (
          <AuroraSkeleton variant="row" count={6} label="Cargando ingresos…" />
        ) : records.length === 0 ? (
          <div className="siembra-empty-state">
            <FiDollarSign size={36} />
            <p>Aún no hay ingresos registrados.</p>
            <button className="aur-btn-pill" onClick={startCreate}>
              <FiPlus /> Registrar primer ingreso
            </button>
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
                <span className="sh-stat-label">Pendiente (CRC)</span>
              </div>
              <div className="sh-stat-divider" />
              <div className="sh-stat">
                <span className="sh-stat-value sh-stat-green">{formatMoney(stats.totalCobrado)}</span>
                <span className="sh-stat-label">Cobrado (CRC)</span>
              </div>
            </div>

            {/* ── Búsqueda global ────────────────────────────────────── */}
            <div className="fin-search-wrap">
              <FiSearch size={14} className="fin-search-icon" />
              <input
                className="fin-search-input"
                aria-label="Buscar ingresos"
                placeholder="Buscar por comprador, lote, estado…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="fin-search-clear" onClick={() => setSearchQuery('')} aria-label="Limpiar búsqueda">
                  <FiX size={14} />
                </button>
              )}
            </div>

            {/* ── Tabla ──────────────────────────────────────────────── */}
            <div className="siembra-historial sh-table-card">
              <div className="historial-top-row">
                <span className="sh-result-count" aria-live="polite">
                  {displayData.length === records.length
                    ? `${records.length} registros`
                    : `${displayData.length} de ${records.length} registros`}
                </span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                  <button
                    className={`fin-table-btn${isCompact ? ' is-active' : ''}`}
                    onClick={() => setMode(isCompact ? 'full' : 'compact')}
                    title={isCompact ? `Mostrar las ${COLUMNS.length} columnas` : 'Mostrar sólo Fecha · Comprador · Lote · Total · Estado'}
                  >
                    <FiLayout size={11} />
                    {isCompact ? `Mostrar todas (${COLUMNS.length} cols)` : 'Vista compacta'}
                  </button>
                  {filtersActive && (
                    <button className="sh-clear-col-filters" onClick={() => { setColFilters({}); setSearchQuery(''); }}>
                      <FiX size={11} /> Limpiar filtros
                    </button>
                  )}
                  <button className="fin-table-btn" onClick={exportCSV} title="Exportar CSV">
                    <FiDownload size={11} /> CSV
                  </button>
                </div>
              </div>

              {displayData.length === 0 ? (
                <p className="empty-state">No hay registros con los filtros aplicados.</p>
              ) : (
                <div className="siembra-table-wrapper">
                  <table className="siembra-table siembra-table-historial">
                    <caption className="aur-sr-only">Ingresos registrados</caption>
                    <thead>
                      <tr>
                        {visibleColumns.map(col => (
                          <SortTh
                            key={col.key}
                            col={col}
                            sortField={sortField}
                            sortDir={sortDir}
                            hasFilter={!!colFilters[col.key]}
                            onSort={handleThSort}
                            onOpenFilter={openColFilter}
                          />
                        ))}
                        <th className="sh-th-settings">
                          <button
                            className={`sh-col-toggle-btn aur-touch-target${hiddenCount > 0 ? ' sh-col-toggle-btn--active' : ''}`}
                            onClick={handleColBtnClick}
                            title="Personalizar columnas"
                            aria-label="Personalizar columnas visibles"
                          >
                            <FiSliders size={12} />
                            {hiddenCount > 0 && (
                              <span className="sh-col-hidden-badge">{hiddenCount}</span>
                            )}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayData.map(r => {
                        const pill = STATUS_BADGE_VARIANT[r.collectionStatus] || STATUS_BADGE_VARIANT.pendiente;
                        const dispCount = dispatchCount(r);
                        const isForeignCurrency = r.currency && r.currency !== 'CRC' && r.totalAmountCRC != null;
                        // row-inactive atenúa la fila anulada (row-anulado no tenía
                        // CSS — audit #2); row-recent le da un flash a la recién tocada.
                        const rowCls = [
                          r.collectionStatus === 'anulado' ? 'row-inactive' : '',
                          r.id === recentId ? 'row-recent' : '',
                        ].filter(Boolean).join(' ');
                        return (
                          <tr key={r.id} className={rowCls}>
                            {isVisible('fecha')     && <td className="td-readonly">{formatShortDate(r.date)}</td>}
                            {isVisible('comprador') && <td>{r.buyerName || '—'}</td>}
                            {isVisible('lote')      && <td>{r.loteNombre || '—'}</td>}
                            {isVisible('despachos') && <td className="td-num">{dispCount || '—'}</td>}
                            {isVisible('cantidad')  && <td className="td-num">{formatNumber(r.quantity)}</td>}
                            {isVisible('unidad')    && <td>{r.unit || '—'}</td>}
                            {isVisible('precio')    && <td className="td-num">{formatPrice(r.unitPrice)}</td>}
                            {isVisible('total')     && (
                              <td
                                className="td-num td-calc"
                                title={isForeignCurrency ? `≈ ${formatMoney(r.totalAmountCRC)}` : undefined}
                              >
                                {formatMoney(r.totalAmount, r.currency)}
                              </td>
                            )}
                            {isVisible('moneda')    && <td>{r.currency || '—'}</td>}
                            {isVisible('estado')    && <td><span className={`aur-badge ${pill.cls}`}>{pill.label}</span></td>}
                            {isVisible('fespera')   && <td className="td-readonly">{formatShortDate(r.expectedCollectionDate)}</td>}
                            {isVisible('fcobro')    && <td className="td-readonly">{formatShortDate(r.actualCollectionDate)}</td>}
                            <td>
                              <div className="hist-kebab-wrap" onPointerDown={e => e.stopPropagation()}>
                                <button
                                  className="hist-kebab-btn aur-touch-target"
                                  title="Más acciones"
                                  aria-label={`Acciones para el ingreso de ${r.buyerName || 'comprador'}`}
                                  aria-haspopup="menu"
                                  aria-expanded={rowMenu === r.id}
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

      {/* ── Menú de columnas ────────────────────────────────────────── */}
      {colMenu && (
        <ColMenu x={colMenu.x} y={colMenu.y} columns={COLUMNS} visibleCols={visibleColsMap} onToggle={toggleColumn} onClose={() => setColMenu(null)} />
      )}

      {/* ── Popover de filtro de columna ────────────────────────────── */}
      {filterPopover && (
        <ColFilterPopover
          popover={filterPopover}
          value={colFilters[filterPopover.field]}
          onChange={(key, val) => setColFilter(filterPopover.field, filterPopover.type, key, val)}
          onClear={() => clearColFilter(filterPopover.field, filterPopover.type)}
          onClose={() => setFilterPopover(null)}
        />
      )}

      {/* ── Kebab dropdown ──────────────────────────────────────────── */}
      {rowMenu !== null && (() => {
        const r = records.find(x => x.id === rowMenu);
        if (!r) return null;
        return (
          <RowKebabMenu
            pos={rowMenuPos}
            onClose={() => setRowMenu(null)}
            items={[
              { icon: <FiEdit2 size={13} />, label: 'Editar', onClick: () => { setRowMenu(null); startEdit(r); } },
              { icon: <FiTrash2 size={13} />, label: 'Eliminar', danger: true, onClick: () => { setRowMenu(null); setConfirmDelete(r); } },
            ]}
          />
        );
      })()}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          loading={deleting}
          loadingLabel="Eliminando…"
          title="Eliminar ingreso"
          body={
            `Vas a eliminar el ingreso de ${confirmDelete.buyerName || 'comprador sin nombre'} ` +
            `por ${formatMoney(confirmDelete.totalAmount, confirmDelete.currency)} ` +
            `del ${formatShortDate(confirmDelete.date)}` +
            `${confirmDelete.loteNombre ? ` · lote ${confirmDelete.loteNombre}` : ''}. ` +
            'Esta acción no se puede deshacer.'
          }
          confirmLabel="Eliminar"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default IncomeRecords;
