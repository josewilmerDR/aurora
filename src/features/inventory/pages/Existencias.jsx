import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import '../styles/agroquimicos.css';
import { FiTrash2, FiClipboard, FiToggleLeft, FiToggleRight, FiSave, FiChevronDown, FiChevronUp, FiBox, FiPlus, FiFilter, FiSliders, FiX, FiShoppingCart, FiClock, FiMenu, FiAlertTriangle } from 'react-icons/fi';
import AuroraFilterPopover from '../../../components/AuroraFilterPopover';
import AuroraModal from '../../../components/AuroraModal';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import { useDraft, markDraftActive, clearDraftActive } from '../../../hooks/useDraft';
import { useTableColumnPreset } from '../../../hooks/useTableColumnPreset';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import { useUser } from '../../../contexts/UserContext';
import {
  TIPOS, MONEDAS, COLUMNS, FIELD_LABELS, COMPACT_COL_IDS,
  NUM_FIELDS, NUM_LIMITS, MAX_LENGTHS, fieldChanged, validateProductField,
} from '../lib/agroquimicos';
import TomaFisicaModal from '../components/TomaFisicaModal';
import EditProductoModal from '../components/EditProductoModal';
import SolicitudDeCompra from './SolicitudDeCompra';

const STOCK_CERO_MSG = 'Solo permitido para productos con existencias en cero.';

function Existencias() {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const { currentUser } = useUser();
  const uid = currentUser?.id || 'anon';

  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [productosLoaded, setProductosLoaded] = useState(false);
  const [showNuevoModal, setShowNuevoModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [showTomaFisica, setShowTomaFisica] = useState(false);
  const [showSolicitud, setShowSolicitud] = useState(false);
  const [kebabOpen, setKebabOpen] = useState(false);
  const [edits, setEdits, clearEditsStorage] = useDraft('inv-productos-edits', {}, { storage: 'local' });
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [colMenu, setColMenu] = useState(null);
  const [sorts, setSorts] = useState([{ field: '', dir: 'asc' }]);
  const [colFilters, setColFilters] = useState({});
  const [filterPop, setFilterPop] = useState(null);
  const [showInactivos, setShowInactivos] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // null | { type: 'delete'|'inactivar', producto }
  const [actionLoading, setActionLoading] = useState(false); // confirm modal (delete/inactivar)
  const [busyId, setBusyId] = useState(null);                // acción inline en vuelo (activar)
  const [flashId, setFlashId] = useState(null);
  const flashTimer = useRef(null);
  const autoExpandedRef = useRef(false);

  // ── Visibilidad de columnas (persistida por usuario; required siempre on) ──
  const { isVisible, toggleColumn, reset, isCompact } =
    useTableColumnPreset(COLUMNS, COMPACT_COL_IDS, `aurora_product_cols_${uid}`);
  const visibleColumns = useMemo(
    () => COLUMNS.filter(c => isVisible(c.key) || c.required),
    [isVisible]
  );
  const hiddenCount = COLUMNS.length - visibleColumns.length;

  // ESC cierra el menú innermost (kebab / menú de columnas / overlay solicitud).
  useEscapeClose(kebabOpen ? () => setKebabOpen(false) : null);
  useEscapeClose(colMenu ? () => setColMenu(null) : null);
  useEscapeClose(showSolicitud ? () => setShowSolicitud(false) : null);

  const fetchProductos = useCallback(() => {
    setLoadError(false);
    apiFetch('/api/productos')
      .then(res => { if (!res.ok) throw new Error('fetch'); return res.json(); })
      .then(data => { setProductos(Array.isArray(data) ? data : []); setProductosLoaded(true); })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { fetchProductos(); }, [fetchProductos]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const flashRow = useCallback((id) => {
    if (!id) return;
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1700);
  }, []);

  const setColFilter = (field, filterObj) => {
    const empty = !filterObj ||
      (filterObj.type === 'range' ? !filterObj.from?.trim() && !filterObj.to?.trim() : !filterObj.value?.trim());
    setColFilters(prev => empty
      ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field))
      : { ...prev, [field]: filterObj }
    );
  };

  const handleColMenuOpen = (e) => {
    e.stopPropagation();
    if (colMenu) { setColMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const menuTop = r.bottom + 4;
    const availableH = window.innerHeight - menuTop - 8;
    // Estima: título ~36px + cada item ~33px + reset ~34px + padding.
    const estimatedH = 36 + COLUMNS.length * 33 + 34 + 12;
    const needsWrap = estimatedH > availableH && availableH >= 160;
    const cols = needsWrap ? Math.min(Math.ceil(estimatedH / Math.max(availableH, 200)), 3) : 1;
    const menuW = cols * 190;
    const menuLeft = Math.max(8, Math.min(r.right - menuW, window.innerWidth - menuW - 8));
    setColMenu({ x: menuLeft, y: menuTop, availableH, cols });
  };

  const getVal = (p, field) =>
    edits[p.id]?.[field] !== undefined ? edits[p.id][field] : (p[field] ?? '');

  const setVal = (p, field, value) => {
    setEdits(prev => ({
      ...prev,
      [p.id]: { ...(prev[p.id] || {}), [field]: value },
    }));
  };

  const dirtyProducts = useMemo(() => {
    return productos.filter(p => {
      const e = edits[p.id];
      if (!e) return false;
      return Object.entries(e).some(([field, val]) => fieldChanged(val, p[field]));
    });
  }, [productos, edits]);

  // Set de ids sucios — se consulta por fila en cada render sin recomputar el
  // .some() por cada una (antes isDirtyRow era O(campos) por fila por render).
  const dirtySet = useMemo(() => new Set(dirtyProducts.map(p => p.id)), [dirtyProducts]);

  // Celdas con valor inválido (largo / rango). Marca el input en vivo y bloquea
  // el guardado sin esperar al confirm. Key: `${id}:${field}`.
  const invalidCells = useMemo(() => {
    const m = {};
    for (const [id, fields] of Object.entries(edits)) {
      for (const [field, val] of Object.entries(fields)) {
        const msg = validateProductField(field, val);
        if (msg) m[`${id}:${field}`] = msg;
      }
    }
    return m;
  }, [edits]);
  const hasInvalid = Object.keys(invalidCells).length > 0;

  // Badge sidebar: pre-marcar al montar si hay drafts guardados en localStorage
  // (antes de que la API responda, para evitar que el badge parpadee).
  useEffect(() => {
    try {
      const savedEdits = localStorage.getItem('aurora_draft_inv-productos-edits');
      if (savedEdits && Object.keys(JSON.parse(savedEdits)).length > 0)
        markDraftActive('inv-productos');

      const savedNuevo = localStorage.getItem('aurora_draft_nuevo-producto');
      if (savedNuevo) {
        const parsed = JSON.parse(savedNuevo);
        if (Object.values(parsed).some(v => v !== '' && v !== 0 && v !== 1 && v !== 'USD'))
          markDraftActive('nuevo-producto');
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Badge sidebar: sincronizar con dirtyProducts una vez cargados los productos.
  useEffect(() => {
    if (!productosLoaded) return;
    if (dirtyProducts.length > 0) markDraftActive('inv-productos');
    else clearDraftActive('inv-productos');
  }, [dirtyProducts.length, productosLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeSummary = useMemo(() => {
    return dirtyProducts.map(p => {
      const e = edits[p.id] || {};
      const changes = Object.entries(e)
        .filter(([field, val]) => fieldChanged(val, p[field]))
        .map(([field, val]) => ({
          field,
          label: FIELD_LABELS[field] || field,
          oldVal: p[field] ?? '—',
          newVal: val || '—',
          error: validateProductField(field, val),
        }));
      return { id: p.id, nombre: p.nombreComercial, changes };
    }).filter(s => s.changes.length > 0);
  }, [dirtyProducts, edits]);

  // ── Acciones destructivas (confirmadas con AuroraConfirmModal) ──────────────
  const confirmDelete = async () => {
    const p = confirmAction.producto;
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/productos/${p.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.message || 'Error al eliminar.'); return; }
      toast.success(`"${p.nombreComercial}" eliminado correctamente.`);
      setConfirmAction(null);
      fetchProductos();
    } catch {
      toast.error('Error al eliminar el producto.');
    } finally {
      setActionLoading(false);
    }
  };

  const confirmInactivar = async () => {
    const p = confirmAction.producto;
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/productos/${p.id}/inactivar`, { method: 'PUT' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.message || 'Error al inactivar.'); return; }
      toast.success(`"${p.nombreComercial}" inactivado.`);
      setConfirmAction(null);
      fetchProductos();
    } catch {
      toast.error('Error al inactivar el producto.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleActivar = async (p) => {
    if (busyId) return;
    setBusyId(p.id);
    try {
      const res = await apiFetch(`/api/productos/${p.id}/activar`, { method: 'PUT' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.message || 'Error al activar.'); return; }
      toast.success(`"${p.nombreComercial}" reactivado.`);
      fetchProductos();
      flashRow(p.id);
    } catch {
      toast.error('Error al activar el producto.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveAll = async () => {
    if (saving || hasInvalid) return;

    setSaving(true);
    const failed = [];
    const succeeded = [];
    for (const p of dirtyProducts) {
      const e = edits[p.id] || {};
      const payload = {};
      for (const [field, val] of Object.entries(e)) {
        if (!fieldChanged(val, p[field])) continue;
        payload[field] = NUM_FIELDS.includes(field) ? (parseFloat(val) || 0) : val;
      }
      if (Object.keys(payload).length === 0) { succeeded.push(p); continue; }
      try {
        const res = await apiFetch(`/api/productos/${p.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) succeeded.push(p); else failed.push(p);
      } catch { failed.push(p); }
    }
    setSaving(false);

    // No perder los cambios que fallaron: conservamos en el draft SOLO esas
    // filas; las exitosas se limpian. Antes se borraba todo y el usuario perdía
    // ediciones no guardadas sin saber cuáles.
    if (failed.length === 0) {
      clearEditsStorage();
      clearDraftActive('inv-productos');
      setShowConfirm(false);
    } else {
      const failedIds = new Set(failed.map(p => p.id));
      setEdits(prev => Object.fromEntries(
        Object.entries(prev).filter(([id]) => failedIds.has(id))
      ));
    }
    fetchProductos();

    const ok = succeeded.length;
    if (failed.length === 0) {
      toast.success(`${ok} producto${ok !== 1 ? 's' : ''} actualizado${ok !== 1 ? 's' : ''}.`);
      flashRow(succeeded[0]?.id);
    } else {
      const nombres = failed.map(p => p.nombreComercial).join(', ');
      toast.error(`${ok} guardado(s) · ${failed.length} con error: ${nombres}. Revisá y reintentá.`);
    }
  };

  const { filteredActivos, filteredInactivos } = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const matchSearch = (p) => !q ||
      p.nombreComercial?.toLowerCase().includes(q) ||
      p.idProducto?.toLowerCase().includes(q) ||
      p.ingredienteActivo?.toLowerCase().includes(q) ||
      p.proveedor?.toLowerCase().includes(q);
    const matchTipo = (p) => !filterTipo || p.tipo === filterTipo;

    const activeColFilters = Object.entries(colFilters).filter(([, f]) => {
      if (!f) return false;
      if (f.type === 'range') return !!(f.from?.trim() || f.to?.trim());
      return !!f.value?.trim();
    });
    // Filtro y sort operan sobre el valor PERSISTIDO (p[field]), no el editado:
    // así las filas no saltan de posición mientras el usuario tipea con un sort
    // activo, y el filtrado refleja los datos reales, no borradores sin guardar.
    const matchColFilters = (p) => {
      for (const [field, filter] of activeColFilters) {
        const cell = p[field] ?? '';
        if (filter.type === 'range') {
          const num = Number(cell);
          if (!isNaN(num)) {
            if (filter.from !== '' && filter.from != null && num < Number(filter.from)) return false;
            if (filter.to   !== '' && filter.to   != null && num > Number(filter.to))   return false;
          }
        } else {
          if (cell == null) return false;
          if (!String(cell).toLowerCase().includes(filter.value.toLowerCase())) return false;
        }
      }
      return true;
    };

    const sortFn = (a, b) => {
      const active = sorts.filter(s => s.field);
      for (const s of active) {
        const av = a[s.field] ?? '';
        const bv = b[s.field] ?? '';
        let r;
        if (av !== '' && bv !== '' && !isNaN(Number(av)) && !isNaN(Number(bv))) {
          r = Number(av) - Number(bv);
        } else {
          r = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
        }
        if (r !== 0) return s.dir === 'desc' ? -r : r;
      }
      return 0;
    };

    const activos = productos
      .filter(p => p.activo !== false && matchSearch(p) && matchTipo(p) && matchColFilters(p))
      .sort(sortFn);
    const inactivos = productos
      .filter(p => p.activo === false && matchSearch(p) && matchTipo(p) && matchColFilters(p))
      .sort(sortFn);
    return { filteredActivos: activos, filteredInactivos: inactivos };
  }, [productos, searchQuery, filterTipo, colFilters, sorts]);

  // Auto-expandir inactivos cuando la búsqueda coincide ahí; auto-colapsar al
  // limpiar la búsqueda (solo si lo abrió la búsqueda, no un toggle manual).
  useEffect(() => {
    if (searchQuery && filteredInactivos.length > 0 && !showInactivos) {
      setShowInactivos(true);
      autoExpandedRef.current = true;
    } else if (!searchQuery && autoExpandedRef.current) {
      setShowInactivos(false);
      autoExpandedRef.current = false;
    }
  }, [searchQuery, filteredInactivos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleInactivos = () => {
    autoExpandedRef.current = false;
    setShowInactivos(v => !v);
  };

  const renderCell = (p, colKey) => {
    const stockBajo = (p.stockActual ?? 0) <= (p.stockMinimo ?? 0);
    const errMsg = invalidCells[`${p.id}:${colKey}`];
    const errClass = errMsg ? ' pg-input--error' : '';
    switch (colKey) {
      case 'nombreComercial':
        return (
          <td key={colKey}>
            <input className={`pg-input${errClass}`} maxLength={64} value={getVal(p, 'nombreComercial')}
              aria-invalid={errMsg ? true : undefined} title={errMsg || undefined}
              onChange={e => setVal(p, 'nombreComercial', e.target.value)} />
          </td>
        );
      case 'stockActual':
        return (
          <td key={colKey} className="pg-stock-cell">
            <span className={`stock-badge ${stockBajo ? 'stock-bajo' : 'stock-ok'}`}>
              {p.stockActual ?? 0} {p.unidad}
            </span>
          </td>
        );
      case 'tipo':
        return (
          <td key={colKey}>
            <select className="pg-input" value={getVal(p, 'tipo')}
              onChange={e => setVal(p, 'tipo', e.target.value)}>
              <option value="">—</option>
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </td>
        );
      case 'moneda':
        return (
          <td key={colKey}>
            <select className="pg-input" value={getVal(p, 'moneda')}
              onChange={e => setVal(p, 'moneda', e.target.value)}>
              {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </td>
        );
      default: {
        const isNum = NUM_FIELDS.includes(colKey);
        return (
          <td key={colKey}>
            <input
              className={`pg-input${isNum ? ' pg-input-num' : ''}${errClass}`}
              type={isNum ? 'number' : 'text'}
              min={isNum ? 0 : undefined}
              max={isNum ? NUM_LIMITS[colKey] : undefined}
              step={isNum ? 0.01 : undefined}
              maxLength={!isNum ? MAX_LENGTHS[colKey] : undefined}
              aria-invalid={errMsg ? true : undefined}
              title={errMsg || undefined}
              value={getVal(p, colKey)}
              onChange={e => setVal(p, colKey, e.target.value)}
            />
          </td>
        );
      }
    }
  };

  const handleTableKeyDown = (e) => {
    const vertical   = e.key === 'ArrowDown' || e.key === 'ArrowUp';
    const horizontal = e.key === 'ArrowRight' || e.key === 'ArrowLeft';
    if (!vertical && !horizontal) return;

    const cell = e.target.closest('td');
    if (!cell) return;
    const row   = cell.closest('tr');
    const cells = [...row.cells];

    // Para inputs de texto: respetar el cursor hasta que llegue al borde.
    if (horizontal && e.target.tagName === 'INPUT' && e.target.type === 'text') {
      const { selectionStart: s, selectionEnd: end, value } = e.target;
      if (e.key === 'ArrowLeft'  && !(s === 0 && end === 0))            return;
      if (e.key === 'ArrowRight' && !(s === value.length && end === value.length)) return;
    }

    const focusIn = (targetCell) => {
      const f = targetCell?.querySelector('input, select');
      if (!f) return false;
      e.preventDefault();
      f.focus();
      if (f.tagName === 'INPUT' && f.type !== 'number') f.select?.();
      return true;
    };

    if (vertical) {
      const colIndex = cells.indexOf(cell);
      if (colIndex === -1) return;
      const targetRow = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      focusIn(targetRow?.cells[colIndex]);
    } else {
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const colIndex = cells.indexOf(cell);
      for (let i = colIndex + delta; i >= 0 && i < cells.length; i += delta) {
        if (focusIn(cells[i])) break;
      }
    }
  };

  // ── SortTh ────────────────────────────────────────────────────────────────
  const SortTh = ({ field, children, filterType = 'text' }) => {
    const active    = sorts[0].field === field;
    const dir       = active ? sorts[0].dir : null;
    const f         = colFilters[field];
    const hasFilter = f ? (f.type === 'range' ? !!(f.from?.trim() || f.to?.trim()) : !!f.value?.trim()) : false;
    return (
      <th
        className={`aur-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-filter' : ''}`}
        onClick={() => setSorts(prev => {
          const next = [...prev];
          if (next[0].field !== field)       next[0] = { field, dir: 'asc' };
          else if (next[0].dir === 'asc')    next[0] = { field, dir: 'desc' };
          else                               next[0] = { field: '', dir: 'asc' };
          return next;
        })}
      >
        <span className="aur-th-content">
          {children}
          <span className="aur-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
          <button
            type="button"
            className={`aur-th-funnel${hasFilter ? ' is-active' : ''}`}
            title="Filtrar columna"
            aria-label={hasFilter ? 'Editar filtro de columna' : 'Filtrar columna'}
            onClick={e => {
              e.stopPropagation();
              if (filterPop?.field === field) { setFilterPop(null); return; }
              const th   = e.currentTarget.closest('th') ?? e.currentTarget;
              const rect = th.getBoundingClientRect();
              setFilterPop({ field, x: rect.left, y: rect.bottom + 4, filterType });
            }}
          >
            <FiFilter size={10} />
          </button>
        </span>
      </th>
    );
  };

  if (!loading && loadError) {
    return (
      <div className="lote-management-layout">
        <EmptyState
          icon={FiAlertTriangle}
          title="No se pudieron cargar los productos."
          subtitle="Revisá tu conexión e intentá de nuevo."
          action={
            <button className="aur-btn-pill" onClick={() => { setLoading(true); fetchProductos(); }}>
              Reintentar
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="lote-management-layout">
      {loading && <div className="pg-page-loading" />}

      {!loading && (
        <>
          <div className="product-list-header">
              <div className="product-title-group">
                <div className="kebab-menu-wrap">
                  <button
                    className="btn-kebab"
                    onClick={() => setKebabOpen(o => !o)}
                    aria-haspopup="menu"
                    aria-expanded={kebabOpen}
                    aria-label="Más opciones"
                    title="Más opciones"
                  >
                    <FiMenu size={17} />
                  </button>
                  {kebabOpen && (
                    <>
                      <div className="kebab-backdrop" onClick={() => setKebabOpen(false)} />
                      <div className="kebab-dropdown" role="menu" aria-label="Más opciones">
                        <Link
                          to="/bodega/agroquimicos/movimientos"
                          role="menuitem"
                          className="kebab-item"
                          onClick={() => setKebabOpen(false)}
                        >
                          <FiClock size={14} /> Historial
                        </Link>
                        <button type="button" role="menuitem" className="kebab-item"
                          onClick={() => { setShowSolicitud(true); setKebabOpen(false); }}>
                          <FiShoppingCart size={14} /> Solicitar Compra
                        </button>
                        <button type="button" role="menuitem" className="kebab-item"
                          onClick={() => { setShowTomaFisica(true); setKebabOpen(false); }}>
                          <FiClipboard size={14} /> Toma Física
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div className="lote-page-title-block">
                  <h2>Existencias</h2>
                  <p className="lote-page-hint">
                    Crea, solicita, haz reajustes y seguimiento a tus agroquímicos todo desde este lugar
                  </p>
                </div>
              </div>
              <div className="product-header-actions">
                {dirtyProducts.length > 0 && (
                  <button className="btn-save-grid" onClick={() => setShowConfirm(true)}>
                    <FiSave size={15} />
                    <span className="pg-save-label">Ver cambios </span>({dirtyProducts.length})
                  </button>
                )}
                <button onClick={() => setShowNuevoModal(true)} className="aur-btn-pill">
                  <FiPlus size={14} /> Nuevo Producto
                </button>
              </div>
            </div>
            <div className="product-filters">
              <input
                type="text"
                className="product-search-input"
                placeholder="Buscar por nombre, ID o ingrediente…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <select
                className="product-filter-select"
                value={filterTipo}
                onChange={e => setFilterTipo(e.target.value)}
              >
                <option value="">Todos los tipos</option>
                {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {Object.keys(colFilters).length > 0 && (
                <button
                  className="btn-toma-fisica"
                  onClick={() => setColFilters({})}
                  title="Limpiar filtros de columna"
                >
                  <FiX size={13} />
                  Limpiar filtros
                </button>
              )}
            </div>

            <div className="product-grid-wrap">
              <table className="product-grid-table" onKeyDown={handleTableKeyDown}>
                <thead>
                  <tr>
                    {visibleColumns.map(col => (
                      <SortTh key={col.key} field={col.key} filterType={col.filterType || 'text'}>
                        {col.label}
                      </SortTh>
                    ))}
                    <th className="pg-col-del">
                      <button
                        className={`aur-col-menu-trigger${hiddenCount > 0 ? ' is-active' : ''}`}
                        onClick={handleColMenuOpen}
                        title={hiddenCount > 0
                          ? `Gestionar columnas (${hiddenCount} oculta${hiddenCount === 1 ? '' : 's'})`
                          : 'Gestionar columnas'}
                        aria-label={hiddenCount > 0
                          ? `Gestionar columnas (${hiddenCount} oculta${hiddenCount === 1 ? '' : 's'})`
                          : 'Gestionar columnas'}
                      >
                        <FiSliders size={13} />
                        {hiddenCount > 0 && (
                          <span className="aur-col-hidden-badge" aria-hidden="true">{hiddenCount}</span>
                        )}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActivos.map(p => {
                    const hasStock = (p.stockActual ?? 0) > 0;
                    const rowClass = [
                      dirtySet.has(p.id) ? 'pg-row-dirty' : '',
                      flashId === p.id ? 'pg-row-flash' : '',
                    ].filter(Boolean).join(' ');
                    return (
                    <tr key={p.id} className={rowClass}>
                      {visibleColumns.map(col => renderCell(p, col.key))}
                      <td className="pg-del-cell">
                        <div className="pg-row-actions">
                          <button
                            className="pg-row-action pg-inactivar-btn"
                            onClick={() => setConfirmAction({ type: 'inactivar', producto: p })}
                            disabled={hasStock}
                            aria-label={`Inactivar ${p.nombreComercial}`}
                            title={hasStock ? STOCK_CERO_MSG : 'Inactivar producto'}
                          >
                            <FiToggleLeft size={16} />
                          </button>
                          <button
                            className="pg-row-action pg-delete-btn"
                            onClick={() => setConfirmAction({ type: 'delete', producto: p })}
                            disabled={hasStock}
                            aria-label={`Eliminar ${p.nombreComercial}`}
                            title={hasStock ? STOCK_CERO_MSG : 'Eliminar producto'}
                          >
                            <FiTrash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredActivos.length === 0 && (
                (searchQuery || filterTipo || Object.keys(colFilters).length > 0) ? (
                  <EmptyState
                    variant="compact"
                    icon={FiFilter}
                    title="Sin resultados para la búsqueda actual"
                    subtitle="Ajusta los filtros o limpia la búsqueda para ver más productos."
                  />
                ) : (
                  <EmptyState
                    variant="compact"
                    icon={FiBox}
                    title="No hay productos creados aún"
                    subtitle="Registra el primer producto desde el botón “Nuevo producto”."
                  />
                )
              )}
            </div>

            {/* Sección colapsable de productos inactivos */}
            {(filteredInactivos.length > 0 || productos.some(p => p.activo === false)) && (
              <div className="pg-inactivos-section">
                <button
                  className="pg-inactivos-toggle"
                  onClick={toggleInactivos}
                  aria-expanded={showInactivos}
                >
                  <span className="pg-inactivos-toggle-label">
                    Productos inactivos
                    <span className="pg-inactivos-count">{filteredInactivos.length}</span>
                  </span>
                  {showInactivos ? <FiChevronUp size={15} /> : <FiChevronDown size={15} />}
                </button>

                {showInactivos && (
                  <div className="product-grid-wrap">
                    <table className="product-grid-table" onKeyDown={handleTableKeyDown}>
                      <thead>
                        <tr>
                          {visibleColumns.map(col => (
                            <SortTh key={col.key} field={col.key} filterType={col.filterType || 'text'}>
                              {col.label}
                            </SortTh>
                          ))}
                          <th className="pg-col-del"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredInactivos.map(p => {
                          const hasStock = (p.stockActual ?? 0) > 0;
                          const rowClass = [
                            'pg-row-inactive',
                            dirtySet.has(p.id) ? 'pg-row-dirty' : '',
                            flashId === p.id ? 'pg-row-flash' : '',
                          ].filter(Boolean).join(' ');
                          return (
                          <tr key={p.id} className={rowClass}>
                            {visibleColumns.map(col => renderCell(p, col.key))}
                            <td className="pg-del-cell">
                              <div className="pg-row-actions">
                                <button
                                  className="pg-row-action pg-activar-btn"
                                  onClick={() => handleActivar(p)}
                                  disabled={busyId === p.id}
                                  aria-label={`Reactivar ${p.nombreComercial}`}
                                  title="Reactivar producto"
                                >
                                  <FiToggleRight size={16} />
                                </button>
                                <button
                                  className="pg-row-action pg-delete-btn"
                                  onClick={() => setConfirmAction({ type: 'delete', producto: p })}
                                  disabled={hasStock}
                                  aria-label={`Eliminar ${p.nombreComercial}`}
                                  title={hasStock ? STOCK_CERO_MSG : 'Eliminar producto'}
                                >
                                  <FiTrash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredInactivos.length === 0 && (
                      <EmptyState
                        variant="compact"
                        icon={FiFilter}
                        title="Sin resultados para la búsqueda actual"
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

      {/* Filter popover portal */}
      {filterPop && (
        filterPop.filterType !== 'text' ? (
          <AuroraFilterPopover
            x={filterPop.x}
            y={filterPop.y}
            filterType="number"
            fromValue={colFilters[filterPop.field]?.from || ''}
            toValue={colFilters[filterPop.field]?.to || ''}
            onFromChange={(from) => setColFilter(filterPop.field, { type: 'range', from, to: colFilters[filterPop.field]?.to || '' })}
            onToChange={(to) => setColFilter(filterPop.field, { type: 'range', from: colFilters[filterPop.field]?.from || '', to })}
            onClear={() => setColFilter(filterPop.field, null)}
            onClose={() => setFilterPop(null)}
          />
        ) : (
          <AuroraFilterPopover
            x={filterPop.x}
            y={filterPop.y}
            filterType="text"
            textValue={colFilters[filterPop.field]?.value || ''}
            onTextChange={(value) => setColFilter(filterPop.field, { type: 'text', value })}
            onClear={() => setColFilter(filterPop.field, null)}
            onClose={() => setFilterPop(null)}
          />
        )
      )}

      {/* Column menu portal */}
      {colMenu && createPortal(
        <>
          <div className="aur-filter-backdrop" onClick={() => setColMenu(null)} />
          <div
            className={`aur-col-menu${colMenu.cols > 1 ? ' aur-col-menu--multi' : ''}`}
            style={{ left: colMenu.x, top: colMenu.y, maxHeight: colMenu.availableH, ...(colMenu.cols > 1 ? { width: colMenu.cols * 190 } : {}) }}
            role="dialog"
            aria-label="Columnas visibles"
          >
            <div className="aur-col-menu-title">Columnas visibles</div>
            <div className={`aur-col-menu-items${colMenu.cols > 1 ? ' aur-col-menu-items--multi' : ''}`}>
              {COLUMNS.map(col => (
                <label
                  key={col.key}
                  className={`aur-col-menu-item${col.required ? ' aur-col-menu-item--disabled' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isVisible(col.key) || !!col.required}
                    disabled={col.required}
                    onChange={() => !col.required && toggleColumn(col.key)}
                  />
                  <span>{col.label}{col.required && <span className="aur-col-menu-lock" aria-hidden="true">🔒</span>}</span>
                </label>
              ))}
            </div>
            {!isCompact && (
              <button className="aur-col-menu-reset" onClick={() => { reset(); setColMenu(null); }}>
                Restaurar por defecto
              </button>
            )}
          </div>
        </>,
        document.body
      )}

      {/* Modal de confirmación de cambios */}
      {showConfirm && (
        <AuroraModal
          size="lg"
          scrollable
          className="pg-confirm-modal"
          title="Confirmar cambios"
          onClose={() => { if (!saving) setShowConfirm(false); }}
          preventClose={saving}
          footer={
            <>
              <button
                className="aur-btn-text"
                onClick={() => { clearEditsStorage(); clearDraftActive('inv-productos'); setShowConfirm(false); }}
                disabled={saving}
              >
                Descartar
              </button>
              <button className="aur-btn-pill" onClick={handleSaveAll} disabled={saving || hasInvalid}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </>
          }
        >
          <p className="pg-confirm-desc">
            Se actualizarán <strong>{changeSummary.length} producto{changeSummary.length !== 1 ? 's' : ''}</strong>. Revisa los cambios antes de confirmar.
          </p>
          {hasInvalid && (
            <p className="pg-confirm-invalid" role="alert">
              <FiAlertTriangle size={14} /> Hay valores fuera de rango (marcados en rojo). Corregilos antes de guardar.
            </p>
          )}
          <div className="pg-confirm-list">
            {changeSummary.map(s => (
              <div key={s.id} className="pg-confirm-product">
                <div className="pg-confirm-product-name">{s.nombre}</div>
                <table className="pg-confirm-table">
                  <thead>
                    <tr><th>Campo</th><th>Valor anterior</th><th>Valor nuevo</th></tr>
                  </thead>
                  <tbody>
                    {s.changes.map((c, i) => (
                      <tr key={i} className={c.error ? 'pg-confirm-row-invalid' : ''}>
                        <td className="pg-confirm-field">{c.label}</td>
                        <td className="pg-confirm-old">{String(c.oldVal)}</td>
                        <td className="pg-confirm-new">
                          {String(c.newVal)}
                          {c.error && <span className="pg-confirm-err"> — {c.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </AuroraModal>
      )}

      {/* Confirmación de inactivar / eliminar */}
      {confirmAction?.type === 'inactivar' && (
        <AuroraConfirmModal
          title="Inactivar producto"
          body={`¿Inactivar "${confirmAction.producto.nombreComercial}"? Stock actual: ${confirmAction.producto.stockActual ?? 0} ${confirmAction.producto.unidad || ''}. Quedará oculto en las alertas de inventario y en los listados activos; podés reactivarlo cuando quieras.`}
          confirmLabel="Inactivar"
          loading={actionLoading}
          loadingLabel="Inactivando…"
          onConfirm={confirmInactivar}
          onCancel={() => { if (!actionLoading) setConfirmAction(null); }}
        />
      )}
      {confirmAction?.type === 'delete' && (
        <AuroraConfirmModal
          danger
          title="Eliminar producto"
          body={`¿Eliminar "${confirmAction.producto.nombreComercial}" permanentemente? Stock actual: ${confirmAction.producto.stockActual ?? 0} ${confirmAction.producto.unidad || ''}. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          loading={actionLoading}
          loadingLabel="Eliminando…"
          onConfirm={confirmDelete}
          onCancel={() => { if (!actionLoading) setConfirmAction(null); }}
        />
      )}

      {showTomaFisica && (
        <TomaFisicaModal
          productos={productos}
          onClose={() => setShowTomaFisica(false)}
          onSuccess={(cantidad) => {
            setShowTomaFisica(false);
            fetchProductos();
            toast.success(`Ajuste aplicado: ${cantidad} producto${cantidad !== 1 ? 's' : ''} actualizado${cantidad !== 1 ? 's' : ''}.`);
          }}
        />
      )}

      {showNuevoModal && (
        <EditProductoModal
          isNew
          onClose={() => setShowNuevoModal(false)}
          onSaved={(data) => {
            setShowNuevoModal(false);
            fetchProductos();
            toast.success(`"${data.nombreComercial}" creado correctamente.`);
          }}
        />
      )}

      {showSolicitud && (
        <div
          className="ingreso-scan-overlay"
          onClick={e => { if (e.target === e.currentTarget) setShowSolicitud(false); }}
        >
          <div className="ingreso-scan-modal" role="dialog" aria-modal="true" aria-label="Solicitud de compra">
            <button
              type="button"
              className="ingreso-scan-modal-close"
              onClick={() => setShowSolicitud(false)}
              aria-label="Cerrar"
            >
              <FiX size={18} />
            </button>
            <SolicitudDeCompra onClose={() => setShowSolicitud(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default Existencias;
