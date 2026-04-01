import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import './ProductManagement.css';
import { FiTrash2, FiClipboard, FiToggleLeft, FiToggleRight, FiSave, FiChevronDown, FiChevronUp, FiBox, FiPlus, FiFilter, FiSliders, FiX, FiShoppingCart, FiList, FiMenu } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { useDraft, markDraftActive, clearDraftActive } from '../hooks/useDraft';
import TomaFisicaModal from './TomaFisicaModal';
import EditProductoModal from './EditProductoModal';
import PurchaseRequest from './PurchaseRequest';

const TIPOS = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];
const MONEDAS = ['USD', 'CRC', 'EUR'];
const LS_KEY = 'aurora_product_cols';

// Definición completa de columnas
const COLUMNS = [
  { key: 'idProducto',            label: 'ID Producto',        thClass: 'pg-col-id',        defaultVisible: true                        },
  { key: 'nombreComercial',       label: 'Nombre Comercial',   thClass: 'pg-col-name',      defaultVisible: true,  required: true       },
  { key: 'ingredienteActivo',     label: 'Ingrediente Activo', thClass: 'pg-col-ing',       defaultVisible: true                        },
  { key: 'tipo',                  label: 'Tipo',               thClass: 'pg-col-tipo',      defaultVisible: true                        },
  { key: 'plagaQueControla',      label: 'Plaga / Enfermedad', thClass: 'pg-col-plaga',     defaultVisible: true                        },
  { key: 'cantidadPorHa',         label: 'Dosis/Ha',           thClass: 'pg-col-dosis',     defaultVisible: true,  filterType: 'number' },
  { key: 'unidad',                label: 'Unidad',             thClass: 'pg-col-unidad',    defaultVisible: true                        },
  { key: 'periodoReingreso',      label: 'Reingreso (h)',      thClass: 'pg-col-reingreso', defaultVisible: false, filterType: 'number' },
  { key: 'periodoACosecha',       label: 'A Cosecha (días)',   thClass: 'pg-col-cosecha',   defaultVisible: false, filterType: 'number' },
  { key: 'stockActual',           label: 'Stock actual',       thClass: 'pg-col-stock',     defaultVisible: true,  required: true, filterType: 'number' },
  { key: 'stockMinimo',           label: 'Stock mínimo',       thClass: 'pg-col-stockmin',  defaultVisible: true,  filterType: 'number' },
  { key: 'precioUnitario',        label: 'Precio unitario',    thClass: 'pg-col-precio',    defaultVisible: true,  filterType: 'number' },
  { key: 'moneda',                label: 'Moneda',             thClass: 'pg-col-moneda',    defaultVisible: false                       },
  { key: 'iva',                   label: 'IVA (%)',            thClass: 'pg-col-iva',       defaultVisible: false, filterType: 'number' },
  { key: 'proveedor',             label: 'Proveedor',          thClass: 'pg-col-proveedor', defaultVisible: true                        },
  { key: 'registroFitosanitario', label: 'Reg. Fitosanitario', thClass: 'pg-col-registro',  defaultVisible: false                       },
  { key: 'observacion',           label: 'Observación',        thClass: 'pg-col-obs',       defaultVisible: false                       },
];

const FIELD_LABELS = Object.fromEntries(COLUMNS.map(c => [c.key, c.label]));
const NUM_FIELDS = ['cantidadPorHa', 'periodoReingreso', 'periodoACosecha', 'stockMinimo', 'precioUnitario', 'tipoCambio', 'iva'];

function loadVisibleCols() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Ensure required columns are always included
      return new Set([...parsed, ...COLUMNS.filter(c => c.required).map(c => c.key)]);
    }
  } catch { /* ignore */ }
  return new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key));
}

function ProductManagement() {
  const apiFetch = useApiFetch();
  const [productos, setProductos] = useState([]);
  const [productosLoaded, setProductosLoaded] = useState(false);
  const [showNuevoModal, setShowNuevoModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [toast, setToast] = useState(null);
  const [showTomaFisica, setShowTomaFisica] = useState(false);
  const [showSolicitud, setShowSolicitud] = useState(false);
  const [kebabOpen, setKebabOpen] = useState(false);
  const [edits, setEdits, clearEditsStorage] = useDraft('inv-productos-edits', {}, { storage: 'local' });
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visibleCols, setVisibleCols] = useState(loadVisibleCols);
  const [colMenu, setColMenu] = useState(null);
  const [sorts, setSorts] = useState([{ field: '', dir: 'asc' }]);
  const [colFilters, setColFilters] = useState({});
  const [filterPop, setFilterPop] = useState(null);
  const [showInactivos, setShowInactivos] = useState(false);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchProductos = (clearEdits = false) => {
    apiFetch('/api/productos').then(res => res.json()).then(data => {
      setProductos(data);
      setProductosLoaded(true);
      if (clearEdits) {
        clearEditsStorage();
        clearDraftActive('inv-productos');
      }
    }).catch(console.error);
  };

  useEffect(() => { fetchProductos(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCol = useCallback((key) => {
    setVisibleCols(prev => {
      const col = COLUMNS.find(c => c.key === key);
      if (col?.required) return prev;
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      return next;
    });
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
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu(prev => prev ? null : { x: r.right - 190, y: r.bottom + 4 });
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
      return Object.entries(e).some(([field, val]) => String(val) !== String(p[field] ?? ''));
    });
  }, [productos, edits]);

  // Badge sidebar: pre-marcar al montar si hay drafts guardados en localStorage
  // (antes de que la API responda, para evitar que el badge parpadee)
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

  // Badge sidebar: sincronizar con dirtyProducts una vez cargados los productos
  useEffect(() => {
    if (!productosLoaded) return;
    if (dirtyProducts.length > 0) markDraftActive('inv-productos');
    else clearDraftActive('inv-productos');
  }, [dirtyProducts.length, productosLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeSummary = useMemo(() => {
    return dirtyProducts.map(p => {
      const e = edits[p.id] || {};
      const changes = Object.entries(e)
        .filter(([field, val]) => String(val) !== String(p[field] ?? ''))
        .map(([field, val]) => ({
          label: FIELD_LABELS[field] || field,
          oldVal: p[field] ?? '—',
          newVal: val || '—',
        }));
      return { id: p.id, nombre: p.nombreComercial, changes };
    }).filter(s => s.changes.length > 0);
  }, [dirtyProducts, edits]);

  const STOCK_CERO_MSG = 'Esta acción solo es permitida para productos con existencias nulas.';

  const handleDelete = async (p) => {
    if ((p.stockActual ?? 0) > 0) {
      showToast(STOCK_CERO_MSG, 'error');
      return;
    }
    if (window.confirm(`¿Eliminar "${p.nombreComercial}" permanentemente?`)) {
      try {
        const res = await apiFetch(`/api/productos/${p.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || 'Error al eliminar.', 'error'); return; }
        fetchProductos();
        showToast('Producto eliminado correctamente.');
      } catch {
        showToast('Error al eliminar el producto.', 'error');
      }
    }
  };

  const handleInactivar = async (p) => {
    if ((p.stockActual ?? 0) > 0) {
      showToast(STOCK_CERO_MSG, 'error');
      return;
    }
    if (window.confirm(`¿Inactivar "${p.nombreComercial}"? El producto quedará oculto en alertas de inventario.`)) {
      try {
        const res = await apiFetch(`/api/productos/${p.id}/inactivar`, { method: 'PUT' });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || 'Error al inactivar.', 'error'); return; }
        fetchProductos();
        showToast(`"${p.nombreComercial}" inactivado.`);
      } catch {
        showToast('Error al inactivar el producto.', 'error');
      }
    }
  };

  const handleActivar = async (p) => {
    try {
      const res = await apiFetch(`/api/productos/${p.id}/activar`, { method: 'PUT' });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || 'Error al activar.', 'error'); return; }
      fetchProductos();
      showToast(`"${p.nombreComercial}" reactivado.`);
    } catch {
      showToast('Error al activar el producto.', 'error');
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    let ok = 0, err = 0;
    for (const p of dirtyProducts) {
      const payload = {};
      Object.keys(FIELD_LABELS).forEach(field => {
        const val = getVal(p, field);
        payload[field] = NUM_FIELDS.includes(field) ? (parseFloat(val) || 0) : val;
      });
      try {
        const res = await apiFetch(`/api/productos/${p.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) ok++; else err++;
      } catch { err++; }
    }
    setSaving(false);
    setShowConfirm(false);
    fetchProductos(true); // true = limpiar edits tras guardar
    showToast(
      `${ok} producto${ok !== 1 ? 's' : ''} actualizado${ok !== 1 ? 's' : ''}${err > 0 ? ` · ${err} error(es)` : ''}.`,
      err > 0 ? 'error' : 'success'
    );
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
    const matchColFilters = (p) => {
      for (const [field, filter] of activeColFilters) {
        const cell = getVal(p, field);
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
        const av = getVal(a, s.field);
        const bv = getVal(b, s.field);
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
  }, [productos, searchQuery, filterTipo, colFilters, sorts, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-expandir inactivos cuando la búsqueda tiene coincidencias ahí
  useEffect(() => {
    if (filteredInactivos.length > 0 && searchQuery) setShowInactivos(true);
  }, [filteredInactivos.length, searchQuery]);

  const isDirtyRow = (p) => !!edits[p.id] && Object.entries(edits[p.id]).some(
    ([field, val]) => String(val) !== String(p[field] ?? '')
  );

  const visibleColumns = COLUMNS.filter(c => visibleCols.has(c.key));

  const renderCell = (p, colKey) => {
    const stockBajo = (p.stockActual ?? 0) <= (p.stockMinimo ?? 0);
    switch (colKey) {
      case 'nombreComercial':
        return (
          <td key={colKey}>
            <div className="pg-name-cell">
              <input className="pg-input" value={getVal(p, 'nombreComercial')}
                onChange={e => setVal(p, 'nombreComercial', e.target.value)} />
              {p.activo === false && <span className="pg-inactive-badge">Inactivo</span>}
            </div>
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
              className={`pg-input${isNum ? ' pg-input-num' : ''}`}
              type={isNum ? 'number' : 'text'}
              min={isNum ? 0 : undefined}
              step={isNum ? 0.01 : undefined}
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

    // Para inputs de texto: respetar el cursor hasta que llegue al borde
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
        className={`historial-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-col-filter' : ''}`}
        onClick={() => setSorts(prev => {
          const next = [...prev];
          if (next[0].field !== field)       next[0] = { field, dir: 'asc' };
          else if (next[0].dir === 'asc')    next[0] = { field, dir: 'desc' };
          else                               next[0] = { field: '', dir: 'asc' };
          return next;
        })}
      >
        {children}
        <span className="historial-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        <span
          className={`historial-th-funnel${hasFilter ? ' is-active' : ''}`}
          title="Filtrar columna"
          onClick={e => {
            e.stopPropagation();
            if (filterPop?.field === field) { setFilterPop(null); return; }
            const th   = e.currentTarget.closest('th') ?? e.currentTarget;
            const rect = th.getBoundingClientRect();
            setFilterPop({ field, x: rect.left, y: rect.bottom + 4, filterType });
          }}
        >
          <FiFilter size={10} />
        </span>
      </th>
    );
  };

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="list-card" style={{ gridColumn: '1 / -1' }}>

        {productos.length === 0 ? (
          <div className="pg-empty-state">
            <FiBox size={32} />
            <p>No hay productos que mostrar</p>
            <button className="btn btn-primary" onClick={() => setShowNuevoModal(true)}>
              <FiPlus size={14} /> Crear el primero
            </button>
          </div>
        ) : (
          <>
            <div className="product-list-header">
              <div className="product-title-group">
                <div className="kebab-menu-wrap">
                  <button className="btn-kebab" onClick={() => setKebabOpen(o => !o)} title="Más opciones">
                    <FiMenu size={17} />
                  </button>
                  {kebabOpen && (
                    <>
                      <div className="kebab-backdrop" onClick={() => setKebabOpen(false)} />
                      <ul className="kebab-dropdown">
                        <li onClick={() => { setShowSolicitud(true); setKebabOpen(false); }}>
                          <FiShoppingCart size={14} /> Solicitar Compra
                        </li>
                        <li onClick={() => { setShowTomaFisica(true); setKebabOpen(false); }}>
                          <FiClipboard size={14} /> Toma Física
                        </li>
                        <li onClick={() => setKebabOpen(false)}>
                          <Link to="/bodega/agroquimicos/movimientos" className="kebab-link">
                            <FiList size={14} /> Historial
                          </Link>
                        </li>
                      </ul>
                    </>
                  )}
                </div>
                <h2>Existencias</h2>
              </div>
              <div className="product-header-actions">
                {dirtyProducts.length > 0 && (
                  <button className="btn-save-grid" onClick={() => setShowConfirm(true)}>
                    <FiSave size={15} />
                    <span className="pg-save-label">Ver cambios </span>({dirtyProducts.length})
                  </button>
                )}
                <button className="btn-nuevo-producto" onClick={() => setShowNuevoModal(true)} title="Nuevo Producto">
                  <FiPlus size={15} />
                  <span className="btn-nuevo-label">Nuevo Producto</span>
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
                        className={`hor-col-toggle-btn${visibleCols.size < COLUMNS.length ? ' hor-col-toggle-btn--active' : ''}`}
                        onClick={handleColMenuOpen}
                        title="Gestionar columnas"
                      >
                        <FiSliders size={13} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActivos.map(p => (
                    <tr key={p.id} className={isDirtyRow(p) ? 'pg-row-dirty' : ''}>
                      {visibleColumns.map(col => renderCell(p, col.key))}
                      <td className="pg-del-cell">
                        <div className="pg-row-actions">
                          <button
                            className={`ingreso-row-del pg-inactivar-btn${(p.stockActual ?? 0) > 0 ? ' pg-action-locked' : ''}`}
                            onClick={() => handleInactivar(p)}
                            title={(p.stockActual ?? 0) > 0 ? STOCK_CERO_MSG : 'Inactivar producto'}
                          >
                            <FiToggleLeft size={15} />
                          </button>
                          <button
                            className={`ingreso-row-del${(p.stockActual ?? 0) > 0 ? ' pg-action-locked' : ''}`}
                            onClick={() => handleDelete(p)}
                            title={(p.stockActual ?? 0) > 0 ? STOCK_CERO_MSG : 'Eliminar producto'}
                          >
                            <FiTrash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredActivos.length === 0 && (
                <p className="empty-state" style={{ padding: '20px' }}>Sin resultados para la búsqueda actual.</p>
              )}
            </div>

            {/* Sección colapsable de productos inactivos */}
            {(filteredInactivos.length > 0 || productos.some(p => p.activo === false)) && (
              <div className="pg-inactivos-section">
                <button
                  className="pg-inactivos-toggle"
                  onClick={() => setShowInactivos(v => !v)}
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
                        {filteredInactivos.map(p => (
                          <tr key={p.id} className={['pg-row-inactive', isDirtyRow(p) ? 'pg-row-dirty' : ''].filter(Boolean).join(' ')}>
                            {visibleColumns.map(col => renderCell(p, col.key))}
                            <td className="pg-del-cell">
                              <div className="pg-row-actions">
                                <button
                                  className="ingreso-row-del pg-activar-btn"
                                  onClick={() => handleActivar(p)}
                                  title="Reactivar producto"
                                >
                                  <FiToggleRight size={15} />
                                </button>
                                <button
                                  className={`ingreso-row-del${(p.stockActual ?? 0) > 0 ? ' pg-action-locked' : ''}`}
                                  onClick={() => handleDelete(p)}
                                  title={(p.stockActual ?? 0) > 0 ? STOCK_CERO_MSG : 'Eliminar producto'}
                                >
                                  <FiTrash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredInactivos.length === 0 && (
                      <p className="empty-state" style={{ padding: '20px' }}>Sin resultados para la búsqueda actual.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Filter popover portal */}
      {filterPop && createPortal(
        <>
          <div className="historial-filter-backdrop" onClick={() => setFilterPop(null)} />
          <div
            className={`historial-filter-popover${filterPop.filterType !== 'text' ? ' historial-filter-popover--range' : ''}`}
            style={{ left: filterPop.x, top: filterPop.y }}
          >
            <FiFilter size={13} className="historial-filter-popover-icon" />
            {filterPop.filterType !== 'text' ? (
              <>
                <div className="historial-filter-range">
                  <div className="historial-filter-range-row">
                    <span className="historial-filter-range-label">De</span>
                    <input
                      autoFocus
                      type="number"
                      className="historial-filter-input"
                      value={colFilters[filterPop.field]?.from || ''}
                      onChange={e => setColFilter(filterPop.field, { type: 'range', from: e.target.value, to: colFilters[filterPop.field]?.to || '' })}
                      onKeyDown={e => { if (e.key === 'Escape') setFilterPop(null); }}
                    />
                  </div>
                  <div className="historial-filter-range-row">
                    <span className="historial-filter-range-label">A</span>
                    <input
                      type="number"
                      className="historial-filter-input"
                      value={colFilters[filterPop.field]?.to || ''}
                      onChange={e => setColFilter(filterPop.field, { type: 'range', from: colFilters[filterPop.field]?.from || '', to: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Escape') setFilterPop(null); }}
                    />
                  </div>
                </div>
                {(colFilters[filterPop.field]?.from || colFilters[filterPop.field]?.to) && (
                  <button className="historial-filter-clear" onClick={() => { setColFilter(filterPop.field, null); setFilterPop(null); }}>
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
                  value={colFilters[filterPop.field]?.value || ''}
                  onChange={e => setColFilter(filterPop.field, { type: 'text', value: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setFilterPop(null); }}
                />
                {colFilters[filterPop.field]?.value && (
                  <button className="historial-filter-clear" onClick={() => { setColFilter(filterPop.field, null); setFilterPop(null); }}>
                    <FiX size={13} />
                  </button>
                )}
              </>
            )}
          </div>
        </>,
        document.body
      )}

      {/* Column menu portal */}
      {colMenu && createPortal(
        <>
          <div className="hor-col-menu-backdrop" onClick={() => setColMenu(null)} />
          <div className="hor-col-menu" style={{ left: colMenu.x, top: colMenu.y }}>
            <div className="hor-col-menu-title">Columnas visibles</div>
            {COLUMNS.map(col => (
              <button
                key={col.key}
                className={`hor-col-menu-item${!visibleCols.has(col.key) ? ' is-hidden' : ''}${col.required ? ' col-picker-required' : ''}`}
                onClick={() => !col.required && toggleCol(col.key)}
                disabled={col.required}
              >
                <span className="hor-col-menu-check" />
                {col.label}
                {col.required && <span style={{ opacity: 0.4, marginLeft: 4, fontSize: '0.75em' }}>🔒</span>}
              </button>
            ))}
            {visibleCols.size < COLUMNS.filter(c => c.defaultVisible).length && (
              <button className="hor-col-menu-reset" onClick={() => {
                const def = new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key));
                localStorage.setItem(LS_KEY, JSON.stringify([...def]));
                setVisibleCols(def);
                setColMenu(null);
              }}>
                Restaurar por defecto
              </button>
            )}
          </div>
        </>,
        document.body
      )}

      {/* Modal de confirmación de cambios */}
      {showConfirm && (
        <div className="modal-overlay" onClick={() => !saving && setShowConfirm(false)}>
          <div className="modal-content pg-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Confirmar cambios</h2>
              <button className="modal-close-btn" onClick={() => setShowConfirm(false)} disabled={saving}>✕</button>
            </div>
            <p className="toma-fisica-desc">
              Se actualizarán <strong style={{ color: 'var(--aurora-green)' }}>{changeSummary.length} producto{changeSummary.length !== 1 ? 's' : ''}</strong>. Revisa los cambios antes de confirmar.
            </p>
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
                        <tr key={i}>
                          <td className="pg-confirm-field">{c.label}</td>
                          <td className="pg-confirm-old">{String(c.oldVal)}</td>
                          <td className="pg-confirm-new">{String(c.newVal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <div className="toma-fisica-footer">
              <button className="btn btn-secondary" onClick={() => { clearEditsStorage(); clearDraftActive('inv-productos'); setShowConfirm(false); }} disabled={saving}>Descartar</button>
              <button className="btn btn-primary" onClick={handleSaveAll} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTomaFisica && (
        <TomaFisicaModal
          productos={productos}
          onClose={() => setShowTomaFisica(false)}
          onSuccess={(cantidad) => {
            setShowTomaFisica(false);
            fetchProductos();
            showToast(`Ajuste aplicado: ${cantidad} producto${cantidad !== 1 ? 's' : ''} actualizado${cantidad !== 1 ? 's' : ''}.`);
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
            showToast(`"${data.nombreComercial}" creado correctamente.`);
          }}
        />
      )}

      {showSolicitud && (
        <div
          className="ingreso-scan-overlay"
          onClick={e => { if (e.target === e.currentTarget) setShowSolicitud(false); }}
        >
          <div className="ingreso-scan-modal">
            <button
              type="button"
              className="ingreso-scan-modal-close"
              onClick={() => setShowSolicitud(false)}
              aria-label="Cerrar"
            >
              <FiX size={18} />
            </button>
            <PurchaseRequest onClose={() => setShowSolicitud(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default ProductManagement;
