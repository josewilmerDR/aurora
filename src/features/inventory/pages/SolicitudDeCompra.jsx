import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  FiSearch, FiPlus, FiTrash2, FiX, FiCheck,
  FiAlertTriangle, FiShoppingCart, FiUser, FiDroplet, FiFileText
} from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import { translateApiError } from '../../../lib/errorMessages';
import { isStockBajo } from '../lib/agroquimicos';
import '../styles/solicitud-de-compra.css';

const DEPT_PROVEEDURIA = 'proveeduria';
const DEPT_LABEL = 'Proveeduría';      // debe coincidir con el default del backend
const MAX_QTY = 32767;                 // tope SMALLINT en backend
const MAX_NOTAS = 288;

// Normaliza coma decimal (es-CR: "1,5") a punto antes de parsear.
const parseQty = (v) => parseFloat(String(v ?? '').replace(',', '.'));
// Un item con cantidad tipeada pero inválida (≤0, NaN o ≥ tope).
const qtyIsInvalid = (v) => {
  if (v === '' || v == null) return false;
  const n = parseQty(v);
  return !(n > 0 && n < MAX_QTY + 1);
};

const SolicitudDeCompra = () => {
  const apiFetch = useApiFetch();
  const toast = useToast();

  const [productos, setProductos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterBajoStock, setFilterBajoStock] = useState(false);

  const [orderItems, setOrderItems] = useState([]);
  const [responsableId, setResponsableId] = useState(DEPT_PROVEEDURIA);
  const [notas, setNotas] = useState('');

  const [showPreview, setShowPreview] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const previewRef = useRef(null);

  const loadData = useCallback((signal) => {
    setLoading(true);
    setLoadError(false);
    return Promise.all([
      apiFetch('/api/productos', { signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      apiFetch('/api/users/lite', { signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    ])
      .then(([prods, users]) => {
        setProductos(Array.isArray(prods) ? prods : []);
        setUsuarios(Array.isArray(users) ? users : []);
      })
      .catch(err => {
        if (err?.name !== 'AbortError') setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => {
    const ctrl = new AbortController();
    loadData(ctrl.signal);
    return () => ctrl.abort();
  }, [loadData]);

  // ESC cierra el modal innermost (confirm → preview).
  useEscapeClose(showClearConfirm ? () => setShowClearConfirm(false) : null);
  useEscapeClose(showPreview && !showClearConfirm ? () => setShowPreview(false) : null);

  // Mover foco al modal de preview al abrir (foco no se va al fondo).
  useEffect(() => {
    if (showPreview) previewRef.current?.focus();
  }, [showPreview]);

  // Clave estable: doc id, con fallback al SKU si el backend no envía .id.
  const keyOf = (p) => p.id ?? p.idProducto;

  const filteredProducts = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return productos.filter(p => {
      const matchesSearch = !searchTerm ||
        p.nombreComercial?.toLowerCase().includes(q) ||
        p.idProducto?.toLowerCase().includes(q) ||
        p.ingredienteActivo?.toLowerCase().includes(q);
      const matchesFilter = !filterBajoStock || p.stockActual <= p.stockMinimo;
      return matchesSearch && matchesFilter;
    });
  }, [productos, searchTerm, filterBajoStock]);

  const orderIds = useMemo(
    () => new Set(orderItems.map(i => i.productoId)),
    [orderItems]
  );
  const isInOrder = (id) => orderIds.has(id);

  const usuariosById = useMemo(
    () => new Map(usuarios.map(u => [u.id, u.nombre])),
    [usuarios]
  );

  const addProduct = (producto) => {
    const id = keyOf(producto);
    if (id == null) {
      toast.error('Este producto no tiene identificador y no puede agregarse.');
      return;
    }
    if (isInOrder(id)) {
      toast.warning('Este producto ya está en la solicitud');
      return;
    }
    setOrderItems(prev => [...prev, {
      productoId: id,
      nombreComercial: producto.nombreComercial,
      unidad: producto.unidad,
      stockActual: producto.stockActual ?? 0,
      stockMinimo: producto.stockMinimo ?? 0,
      cantidadSolicitada: '',
    }]);
  };

  const updateQuantity = (productoId, value) => {
    setOrderItems(prev => prev.map(i =>
      i.productoId === productoId ? { ...i, cantidadSolicitada: value } : i
    ));
  };

  const removeItem = (productoId) => {
    setOrderItems(prev => prev.filter(i => i.productoId !== productoId));
  };

  const getResponsableNombre = () => {
    if (responsableId === DEPT_PROVEEDURIA) return DEPT_LABEL;
    return usuariosById.get(responsableId) || DEPT_LABEL;
  };

  const validItems = useMemo(
    () => orderItems.filter(i => parseQty(i.cantidadSolicitada) > 0),
    [orderItems]
  );

  const handleOpenPreview = () => {
    if (validItems.length === 0) {
      toast.error('Agrega al menos un producto con cantidad mayor a cero');
      return;
    }
    const outOfRange = validItems.find(i => {
      const n = parseQty(i.cantidadSolicitada);
      return n <= 0 || n >= MAX_QTY + 1;
    });
    if (outOfRange) {
      toast.error(`Cantidad demasiado alta en "${outOfRange.nombreComercial}". Reducila e intentá de nuevo.`);
      return;
    }
    setShowPreview(true);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/solicitudes-compra', {
        method: 'POST',
        body: JSON.stringify({
          responsableId,
          responsableNombre: getResponsableNombre(),
          notas,
          items: validItems.map(i => ({
            ...i,
            cantidadSolicitada: parseQty(i.cantidadSolicitada),
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(translateApiError(body, 'No se pudo enviar la solicitud.'));
      }
      toast.success('Solicitud enviada a ' + getResponsableNombre());
      setOrderItems([]);
      setNotas('');
      setResponsableId(DEPT_PROVEEDURIA);
      setShowPreview(false);
    } catch (err) {
      toast.error(err?.message || 'No se pudo enviar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="pg-page-loading" />;
  }

  if (loadError) {
    return (
      <div className="pr-loading">
        <p>No se pudieron cargar los productos.</p>
        <button className="aur-btn-pill" onClick={() => { const c = new AbortController(); loadData(c.signal); }}>
          Reintentar
        </button>
      </div>
    );
  }

  const hasFilter = Boolean(searchTerm || filterBajoStock);

  return (
    <div className="lote-management-layout">
      <div className="ingreso-title-row">
        <h2 className="ingreso-page-title">Solicitud de Compra</h2>
        <Link
          to="/procurement/ordenes/historial"
          className="aur-chip"
          style={{ marginLeft: 'auto' }}
        >
          <FiFileText size={14} /> Ver solicitudes
        </Link>
        <Link to="/bodega/agroquimicos/existencias" className="aur-chip">
          <FiDroplet size={14} /> Existencias
        </Link>
      </div>

      <div className="pr-layout">
      {/* ══ PANEL IZQUIERDO: catálogo ══ */}
      <div className="pr-catalog">
        <h2 id="pr-catalog-title">Seleccionar Productos</h2>

        {/* Buscador y filtro */}
        <div className="pr-search-bar">
          <div className="pr-search-input-wrap">
            <FiSearch size={16} className="pr-search-icon" />
            <input
              type="text"
              placeholder="Buscar por nombre, ID o ingrediente…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pr-search-input"
              aria-label="Buscar productos"
            />
          </div>
          <label className="pr-filter-toggle">
            <input
              type="checkbox"
              checked={filterBajoStock}
              onChange={e => setFilterBajoStock(e.target.checked)}
            />
            Solo stock bajo
          </label>
        </div>

        {/* Lista de productos */}
        <div className="pr-product-list">
          {filteredProducts.length === 0 && (
            hasFilter ? (
              <div className="pr-empty">
                <p>Ningún producto coincide con el filtro.</p>
                <button
                  className="aur-btn-text"
                  onClick={() => { setSearchTerm(''); setFilterBajoStock(false); }}
                >
                  Limpiar filtros
                </button>
              </div>
            ) : (
              <p className="pr-empty">No hay productos en el catálogo.</p>
            )
          )}
          {filteredProducts.map(p => {
            const id = keyOf(p);
            const isLow = isStockBajo(p);
            const added = isInOrder(id);
            return (
              <div
                key={id}
                className={`pr-product-row ${isLow ? 'pr-product-row--low' : ''} ${added ? 'pr-product-row--added' : ''}`}
              >
                <div className="pr-product-info">
                  <span className="pr-product-name">{p.nombreComercial}</span>
                  <span className="pr-product-meta">
                    {p.idProducto} · {p.ingredienteActivo}
                  </span>
                  <span className={`pr-stock-badge ${isLow ? 'pr-stock-badge--low' : ''}`}>
                    {isLow && <FiAlertTriangle size={12} />}
                    Stock: {p.stockActual} {p.unidad} {isLow ? `(mín ${p.stockMinimo})` : ''}
                  </span>
                </div>
                <button
                  className="aur-icon-btn aur-icon-btn--sm"
                  onClick={() => addProduct(p)}
                  disabled={added}
                  aria-label={added ? `${p.nombreComercial} ya agregado` : `Agregar ${p.nombreComercial} a la solicitud`}
                  title={added ? 'Ya agregado' : 'Agregar a solicitud'}
                >
                  {added ? <FiCheck size={15} /> : <FiPlus size={15} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ══ PANEL DERECHO: orden en construcción ══ */}
      <div className="pr-order">
        <h2>
          <FiShoppingCart size={18} />
          Tu solicitud
          {orderItems.length > 0 && (
            <span className="pr-order-count">{orderItems.length}</span>
          )}
        </h2>

        {/* Responsable */}
        <div className="form-control pr-responsable">
          <label htmlFor="pr-responsable-select"><FiUser size={14} /> Asignar a</label>
          <select
            id="pr-responsable-select"
            value={responsableId}
            onChange={e => setResponsableId(e.target.value)}
          >
            <option value={DEPT_PROVEEDURIA}>{DEPT_LABEL} (Departamento)</option>
            {usuarios.map(u => (
              <option key={u.id} value={u.id}>{u.nombre}</option>
            ))}
          </select>
        </div>

        {/* Items de la orden */}
        <div className="pr-order-grid-wrap">
          <table className="pr-order-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {orderItems.length === 0 ? (
                <tr className="pr-order-empty-row">
                  <td colSpan={2}>
                    <div className="pr-order-empty">
                      <FiShoppingCart size={36} />
                      <p>Agrega productos desde el catálogo</p>
                    </div>
                  </td>
                </tr>
              ) : (
                orderItems.map(item => {
                  const isLow = isStockBajo(item);
                  const invalid = qtyIsInvalid(item.cantidadSolicitada);
                  return (
                    <tr key={item.productoId}>
                      <td>
                        <div className="pr-order-item-name">
                          {isLow && <FiAlertTriangle size={13} className="pr-warn-icon" />}
                          {item.nombreComercial}
                          <span className="pr-order-item-stock">
                            Stock actual: {item.stockActual} {item.unidad}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="pr-order-item-controls">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={MAX_QTY}
                            step="any"
                            placeholder="Cantidad"
                            value={item.cantidadSolicitada}
                            onChange={e => updateQuantity(item.productoId, e.target.value)}
                            className={`pr-qty-input ${invalid ? 'pr-qty-input--invalid' : ''}`}
                            aria-invalid={invalid}
                            aria-label={`Cantidad de ${item.nombreComercial}`}
                          />
                          <span className="pr-unit-label">{item.unidad}</span>
                          <button
                            className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                            onClick={() => removeItem(item.productoId)}
                            aria-label={`Quitar ${item.nombreComercial} de la solicitud`}
                            title="Eliminar"
                          >
                            <FiTrash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Notas */}
        <div className="form-control pr-notes">
          <label htmlFor="pr-notes-input">Notas (opcional)</label>
          <textarea
            id="pr-notes-input"
            rows={3}
            maxLength={MAX_NOTAS}
            placeholder="Urgencia, indicaciones especiales…"
            value={notas}
            onChange={e => setNotas(e.target.value)}
          />
          <span className="pr-char-count">{notas.length}/{MAX_NOTAS}</span>
        </div>

        {/* Acción */}
        <div className="form-actions">
          {orderItems.length > 0 && (
            <button
              className="aur-btn-text"
              onClick={() => setShowClearConfirm(true)}
            >
              <FiX size={16} />
              Limpiar
            </button>
          )}
          <button
            className="aur-btn-pill"
            onClick={handleOpenPreview}
            disabled={validItems.length === 0}
          >
            <FiPlus size={16} />
            Crear solicitud
          </button>
        </div>
      </div>

      {/* ══ MODAL DE PREVIEW ══ */}
      {showPreview && (
        <div
          className="aur-modal-backdrop"
          onClick={e => { if (e.target === e.currentTarget) setShowPreview(false); }}
        >
          <div
            className="aur-modal aur-modal--lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pr-preview-title"
            tabIndex={-1}
            ref={previewRef}
            onClick={e => e.stopPropagation()}
          >
            <header className="aur-modal-header">
              <h2 className="aur-modal-title" id="pr-preview-title">Resumen de Solicitud</h2>
              <button
                className="aur-icon-btn aur-icon-btn--sm aur-modal-close"
                onClick={() => setShowPreview(false)}
                aria-label="Cerrar resumen"
              >
                <FiX size={16} />
              </button>
            </header>

            <div className="aur-modal-content">
              <div className="pr-preview-summary">
                <div>
                  <span className="pr-preview-summary-label">Asignado a</span>
                  <strong className="pr-preview-summary-value">{getResponsableNombre()}</strong>
                </div>
                <div>
                  <span className="pr-preview-summary-label">Productos</span>
                  <strong className="pr-preview-summary-value">{validItems.length}</strong>
                </div>
              </div>

              <p className="pr-preview-hint">
                Al confirmar se enviará la solicitud a {getResponsableNombre()} y se creará una tarea de seguimiento.
              </p>

              {notas && (
                <p className="pr-preview-notas"><strong>Notas:</strong> {notas}</p>
              )}

              <table className="pr-preview-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Stock actual</th>
                    <th>Cantidad solicitada</th>
                  </tr>
                </thead>
                <tbody>
                  {validItems.map(item => (
                    <tr key={item.productoId}>
                      <td>
                        {isStockBajo(item) && (
                          <FiAlertTriangle size={13} className="pr-warn-icon" />
                        )}
                        {item.nombreComercial}
                      </td>
                      <td>{item.stockActual} {item.unidad}</td>
                      <td className="pr-preview-qty">
                        <strong>{parseQty(item.cantidadSolicitada)} {item.unidad}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {validItems.length < orderItems.length && (
                <p className="pr-preview-warning">
                  <FiAlertTriangle size={14} />
                  {orderItems.length - validItems.length} producto(s) sin cantidad serán omitidos.
                </p>
              )}
            </div>

            <div className="aur-modal-actions">
              <button className="aur-btn-text" onClick={() => setShowPreview(false)}>
                <FiX size={16} />
                Volver a editar
              </button>
              <button
                className="aur-btn-pill"
                onClick={handleSubmit}
                disabled={submitting}
              >
                <FiCheck size={16} />
                {submitting ? 'Enviando…' : 'Confirmar solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ CONFIRMACIÓN DE LIMPIAR ══ */}
      {showClearConfirm && (
        <div
          className="aur-modal-backdrop"
          onClick={e => { if (e.target === e.currentTarget) setShowClearConfirm(false); }}
        >
          <div
            className="aur-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pr-clear-title"
          >
            <header className="aur-modal-header">
              <h2 className="aur-modal-title" id="pr-clear-title">Vaciar solicitud</h2>
            </header>
            <div className="aur-modal-content">
              <p>
                Se quitarán los {orderItems.length} producto(s) de la solicitud y se
                perderán las cantidades ingresadas. ¿Continuar?
              </p>
            </div>
            <div className="aur-modal-actions">
              <button className="aur-btn-text" onClick={() => setShowClearConfirm(false)}>
                Cancelar
              </button>
              <button
                className="aur-btn-pill aur-btn-pill--danger"
                onClick={() => { setOrderItems([]); setShowClearConfirm(false); }}
              >
                <FiTrash2 size={16} />
                Vaciar
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default SolicitudDeCompra;
