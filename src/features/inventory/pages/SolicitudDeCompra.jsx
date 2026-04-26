import { useState, useEffect } from 'react';
import {
  FiSearch, FiPlus, FiTrash2, FiEye, FiX, FiCheck,
  FiAlertTriangle, FiShoppingCart, FiUser
} from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/solicitud-de-compra.css';

const DEPT_PROVEEDURIA = 'proveeduria';

const SolicitudDeCompra = ({ onClose } = {}) => {
  const apiFetch = useApiFetch();
  const [productos, setProductos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterBajoStock, setFilterBajoStock] = useState(false);

  const [orderItems, setOrderItems] = useState([]);
  const [responsableId, setResponsableId] = useState(DEPT_PROVEEDURIA);
  const [notas, setNotas] = useState('');

  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/productos').then(r => r.json()),
      apiFetch('/api/users').then(r => r.json()),
    ])
      .then(([prods, users]) => {
        setProductos(prods);
        setUsuarios(users);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const filteredProducts = productos.filter(p => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm ||
      p.nombreComercial?.toLowerCase().includes(q) ||
      p.idProducto?.toLowerCase().includes(q) ||
      p.ingredienteActivo?.toLowerCase().includes(q);
    const matchesFilter = !filterBajoStock || p.stockActual <= p.stockMinimo;
    return matchesSearch && matchesFilter;
  });

  const isInOrder = (id) => orderItems.some(i => i.productoId === id);

  const addProduct = (producto) => {
    if (isInOrder(producto.id)) {
      showToast('Este producto ya está en la solicitud', 'warning');
      return;
    }
    setOrderItems(prev => [...prev, {
      productoId: producto.id,
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
    if (responsableId === DEPT_PROVEEDURIA) return 'Proveeduría';
    return usuarios.find(u => u.id === responsableId)?.nombre || 'Proveeduría';
  };

  const validItems = orderItems.filter(i => parseFloat(i.cantidadSolicitada) > 0);

  const handleOpenPreview = () => {
    if (validItems.length === 0) {
      showToast('Agrega al menos un producto con cantidad mayor a cero', 'error');
      return;
    }
    const outOfRange = validItems.find(i => {
      const n = parseFloat(i.cantidadSolicitada);
      return n <= 0 || n >= 32768;
    });
    if (outOfRange) {
      showToast(`Cantidad fuera de rango en "${outOfRange.nombreComercial}" (máx 32767)`, 'error');
      return;
    }
    if (notas.length > 288) {
      showToast('Las notas no pueden exceder 288 caracteres', 'error');
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responsableId,
          responsableNombre: getResponsableNombre(),
          notas,
          items: validItems.map(i => ({
            ...i,
            cantidadSolicitada: parseFloat(i.cantidadSolicitada),
          })),
        }),
      });
      if (!res.ok) throw new Error();
      showToast('Solicitud enviada exitosamente');
      setOrderItems([]);
      setNotas('');
      setResponsableId(DEPT_PROVEEDURIA);
      setShowPreview(false);
      setTimeout(() => onClose?.(), 1200);
    } catch {
      showToast('Error al enviar la solicitud', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="pr-loading">Cargando productos...</div>;
  }

  return (
    <div className="pr-layout">
      {/* ── Toast ── */}
      {toast && (
        <div className={`pr-toast pr-toast--${toast.type}`}>
          {toast.type === 'error' && <FiX size={16} />}
          {toast.type === 'warning' && <FiAlertTriangle size={16} />}
          {toast.type === 'success' && <FiCheck size={16} />}
          {toast.message}
        </div>
      )}

      {/* ══ PANEL IZQUIERDO: catálogo ══ */}
      <div className="form-card pr-catalog">
        <h2>Seleccionar Productos</h2>

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
            <p className="pr-empty">No se encontraron productos.</p>
          )}
          {filteredProducts.map(p => {
            const isLow = p.stockActual <= p.stockMinimo;
            const added = isInOrder(p.id);
            return (
              <div
                key={p.id}
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
      <div className="form-card pr-order">
        <h2>
          <FiShoppingCart size={18} />
          Solicitud de Compra
          {orderItems.length > 0 && (
            <span className="pr-order-count">{orderItems.length}</span>
          )}
        </h2>

        {/* Responsable */}
        <div className="form-control pr-responsable">
          <label><FiUser size={14} /> Asignar a</label>
          <select
            value={responsableId}
            onChange={e => setResponsableId(e.target.value)}
          >
            <option value={DEPT_PROVEEDURIA}>Proveeduría (Departamento)</option>
            {usuarios.map(u => (
              <option key={u.id} value={u.id}>{u.nombre}</option>
            ))}
          </select>
        </div>

        {/* Items de la orden */}
        {orderItems.length === 0 ? (
          <div className="pr-order-empty">
            <FiShoppingCart size={36} />
            <p>Agrega productos desde el catálogo</p>
          </div>
        ) : (
          <div className="pr-order-items">
            {orderItems.map(item => {
              const isLow = item.stockActual <= item.stockMinimo;
              return (
                <div key={item.productoId} className="pr-order-item">
                  <div className="pr-order-item-name">
                    {isLow && <FiAlertTriangle size={13} className="pr-warn-icon" />}
                    {item.nombreComercial}
                    <span className="pr-order-item-stock">
                      Stock actual: {item.stockActual} {item.unidad}
                    </span>
                  </div>
                  <div className="pr-order-item-controls">
                    <input
                      type="number"
                      min="0"
                      max="32767"
                      step="0.1"
                      placeholder="Cantidad"
                      value={item.cantidadSolicitada}
                      onChange={e => updateQuantity(item.productoId, e.target.value)}
                      className="pr-qty-input"
                    />
                    <span className="pr-unit-label">{item.unidad}</span>
                    <button
                      className="pr-remove-btn"
                      onClick={() => removeItem(item.productoId)}
                      title="Eliminar"
                    >
                      <FiTrash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Notas */}
        <div className="form-control pr-notes">
          <label>Notas (opcional)</label>
          <textarea
            rows={3}
            maxLength={288}
            placeholder="Urgencia, indicaciones especiales…"
            value={notas}
            onChange={e => setNotas(e.target.value)}
          />
        </div>

        {/* Acción */}
        <div className="form-actions">
          <button
            className="aur-btn-pill"
            onClick={handleOpenPreview}
            disabled={orderItems.length === 0}
          >
            <FiEye size={16} />
            Ver resumen
          </button>
          {orderItems.length > 0 && (
            <button
              className="aur-btn-text"
              onClick={() => setOrderItems([])}
            >
              <FiX size={16} />
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* ══ MODAL DE PREVIEW ══ */}
      {showPreview && (
        <div className="aur-modal-backdrop" onPointerDown={() => setShowPreview(false)}>
          <div className="aur-modal aur-modal--lg" onPointerDown={e => e.stopPropagation()}>
            <header className="aur-modal-header">
              <h2 className="aur-modal-title">Resumen de Solicitud</h2>
              <button className="aur-icon-btn aur-icon-btn--sm aur-modal-close" onClick={() => setShowPreview(false)}>
                <FiX size={16} />
              </button>
            </header>

            <div className="aur-modal-content">
              <div className="pr-preview-meta">
                <span><strong>Asignado a:</strong> {getResponsableNombre()}</span>
                {notas && <span><strong>Notas:</strong> {notas}</span>}
              </div>

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
                        {item.stockActual <= item.stockMinimo && (
                          <FiAlertTriangle size={13} className="pr-warn-icon" />
                        )}
                        {item.nombreComercial}
                      </td>
                      <td>{item.stockActual} {item.unidad}</td>
                      <td className="pr-preview-qty">
                        <strong>{parseFloat(item.cantidadSolicitada)} {item.unidad}</strong>
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
    </div>
  );
};

export default SolicitudDeCompra;
