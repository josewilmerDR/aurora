import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './ProductManagement.css';
import { FiTrash2, FiClipboard, FiColumns, FiToggleLeft, FiToggleRight } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { useDraft, markDraftActive, clearDraftActive } from '../hooks/useDraft';
import TomaFisicaModal from './TomaFisicaModal';

const TIPOS = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];
const MONEDAS = ['USD', 'CRC', 'EUR'];
const LS_KEY = 'aurora_product_cols';

// Definición completa de columnas
const COLUMNS = [
  { key: 'idProducto',        label: 'ID Producto',         thClass: 'pg-col-id',        defaultVisible: true  },
  { key: 'nombreComercial',   label: 'Nombre Comercial',    thClass: 'pg-col-name',      defaultVisible: true,  required: true },
  { key: 'ingredienteActivo', label: 'Ingrediente Activo',  thClass: 'pg-col-ing',       defaultVisible: true  },
  { key: 'tipo',              label: 'Tipo',                thClass: 'pg-col-tipo',      defaultVisible: true  },
  { key: 'plagaQueControla',  label: 'Plaga / Enfermedad',  thClass: 'pg-col-plaga',     defaultVisible: true  },
  { key: 'cantidadPorHa',     label: 'Dosis/Ha',            thClass: 'pg-col-dosis',     defaultVisible: true  },
  { key: 'unidad',            label: 'Unidad',              thClass: 'pg-col-unidad',    defaultVisible: true  },
  { key: 'periodoReingreso',  label: 'Reingreso (h)',       thClass: 'pg-col-reingreso', defaultVisible: false },
  { key: 'periodoACosecha',   label: 'A Cosecha (días)',    thClass: 'pg-col-cosecha',   defaultVisible: false },
  { key: 'stockActual',       label: 'Stock actual',        thClass: 'pg-col-stock',     defaultVisible: true,  required: true },
  { key: 'stockMinimo',       label: 'Stock mínimo',        thClass: 'pg-col-stockmin',  defaultVisible: true  },
  { key: 'precioUnitario',    label: 'Precio unitario',     thClass: 'pg-col-precio',    defaultVisible: true  },
  { key: 'moneda',            label: 'Moneda',              thClass: 'pg-col-moneda',    defaultVisible: false },
  { key: 'proveedor',         label: 'Proveedor',           thClass: 'pg-col-proveedor', defaultVisible: true  },
];

const FIELD_LABELS = Object.fromEntries(COLUMNS.map(c => [c.key, c.label]));
const NUM_FIELDS = ['cantidadPorHa', 'periodoReingreso', 'periodoACosecha', 'stockMinimo', 'precioUnitario', 'tipoCambio'];

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
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [toast, setToast] = useState(null);
  const [showTomaFisica, setShowTomaFisica] = useState(false);
  const [edits, setEdits, clearEditsStorage] = useDraft('inv-productos-edits', {});
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visibleCols, setVisibleCols] = useState(loadVisibleCols);
  const [colPicker, setColPicker] = useState(null); // { x, y } | null
  const colPickerRef = useRef(null);
  const colBtnRef = useRef(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchProductos = (clearEdits = false) => {
    apiFetch('/api/productos').then(res => res.json()).then(data => {
      setProductos(data);
      if (clearEdits) {
        clearEditsStorage();
        clearDraftActive('inv-productos');
      }
    }).catch(console.error);
  };

  useEffect(() => { fetchProductos(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close col picker on outside click
  useEffect(() => {
    if (!colPicker) return;
    const handler = (e) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target) &&
          colBtnRef.current && !colBtnRef.current.contains(e.target)) {
        setColPicker(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colPicker]);

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

  const openColPickerFromBtn = () => {
    if (colPicker) { setColPicker(null); return; }
    const rect = colBtnRef.current.getBoundingClientRect();
    setColPicker({ x: rect.right, y: rect.bottom + 6, alignRight: true });
  };

  const handleTheadContextMenu = (e) => {
    e.preventDefault();
    setColPicker({ x: e.clientX, y: e.clientY, alignRight: false });
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

  // Badge sidebar: activo cuando hay cambios sin guardar
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (dirtyProducts.length > 0) markDraftActive('inv-productos');
    else clearDraftActive('inv-productos');
  }, [dirtyProducts.length]);

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

  const filteredProductos = useMemo(() => {
    return productos.filter(p => {
      const q = searchQuery.toLowerCase();
      const matchSearch = !q ||
        p.nombreComercial?.toLowerCase().includes(q) ||
        p.idProducto?.toLowerCase().includes(q) ||
        p.ingredienteActivo?.toLowerCase().includes(q) ||
        p.proveedor?.toLowerCase().includes(q);
      const matchTipo = !filterTipo || p.tipo === filterTipo;
      return matchSearch && matchTipo;
    });
  }, [productos, searchQuery, filterTipo]);

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

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="list-card" style={{ gridColumn: '1 / -1' }}>

        <div className="product-list-header">
          <h2>Inventario de Agroquímicos</h2>
          <div className="product-header-actions">
            {dirtyProducts.length > 0 && (
              <button className="btn-save-grid" onClick={() => setShowConfirm(true)}>
                <FiSave size={15} />
                Guardar {dirtyProducts.length} cambio{dirtyProducts.length !== 1 ? 's' : ''}
              </button>
            )}
            <button
              ref={colBtnRef}
              className={`btn-toma-fisica${colPicker ? ' active' : ''}`}
              onClick={openColPickerFromBtn}
              title="Mostrar / ocultar columnas"
            >
              <FiColumns size={15} />
              Columnas
            </button>
            <button className="btn-toma-fisica" onClick={() => setShowTomaFisica(true)}>
              <FiClipboard size={16} />
              Toma Física
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
        </div>

        <div className="product-grid-wrap">
          <table className="product-grid-table">
            <thead onContextMenu={handleTheadContextMenu}>
              <tr>
                {visibleColumns.map(col => (
                  <th key={col.key} className={col.thClass}
                    title="Clic derecho para gestionar columnas">
                    {col.label}
                  </th>
                ))}
                <th className="pg-col-del"></th>
              </tr>
            </thead>
            <tbody>
              {filteredProductos.map(p => (
                <tr key={p.id} className={[
                  isDirtyRow(p) ? 'pg-row-dirty' : '',
                  p.activo === false ? 'pg-row-inactive' : '',
                ].filter(Boolean).join(' ')}>
                  {visibleColumns.map(col => renderCell(p, col.key))}
                  <td className="pg-del-cell">
                    <div className="pg-row-actions">
                      {p.activo !== false ? (
                        <button
                          className={`ingreso-row-del pg-inactivar-btn${(p.stockActual ?? 0) > 0 ? ' pg-action-locked' : ''}`}
                          onClick={() => handleInactivar(p)}
                          title={(p.stockActual ?? 0) > 0 ? STOCK_CERO_MSG : 'Inactivar producto'}
                        >
                          <FiToggleLeft size={15} />
                        </button>
                      ) : (
                        <button
                          className="ingreso-row-del pg-activar-btn"
                          onClick={() => handleActivar(p)}
                          title="Reactivar producto"
                        >
                          <FiToggleRight size={15} />
                        </button>
                      )}
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
          {filteredProductos.length === 0 && (
            <p className="empty-state" style={{ padding: '20px' }}>
              {productos.length === 0 ? 'No hay productos registrados.' : 'Sin resultados para la búsqueda actual.'}
            </p>
          )}
        </div>
      </div>

      {/* Selector de columnas */}
      {colPicker && (
        <div
          ref={colPickerRef}
          className="col-picker"
          style={{
            top: colPicker.y,
            left: colPicker.alignRight ? 'auto' : colPicker.x,
            right: colPicker.alignRight ? `calc(100vw - ${colPicker.x}px)` : 'auto',
          }}
        >
          <div className="col-picker-title">Columnas visibles</div>
          {COLUMNS.map(col => (
            <label key={col.key} className={`col-picker-item${col.required ? ' col-picker-required' : ''}`}>
              <input
                type="checkbox"
                checked={visibleCols.has(col.key)}
                disabled={col.required}
                onChange={() => toggleCol(col.key)}
              />
              <span>{col.label}</span>
              {col.required && <span className="col-picker-lock">🔒</span>}
            </label>
          ))}
          <div className="col-picker-footer">
            <button className="col-picker-reset" onClick={() => {
              const def = new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key));
              localStorage.setItem(LS_KEY, JSON.stringify([...def]));
              setVisibleCols(def);
            }}>
              Restaurar por defecto
            </button>
          </div>
        </div>
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
              <button className="btn btn-secondary" onClick={() => setShowConfirm(false)} disabled={saving}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveAll} disabled={saving}>
                {saving ? 'Guardando…' : 'Confirmar y guardar'}
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
    </div>
  );
}

export default ProductManagement;
