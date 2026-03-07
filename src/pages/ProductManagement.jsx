import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './ProductManagement.css';
import { FiEdit, FiTrash2 } from 'react-icons/fi';
import Toast from '../components/Toast';

const TIPOS = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];

function formatCurrency(value, moneda) {
  return `${Number(value).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda || ''}`;
}

function ProductManagement() {
  const navigate = useNavigate();
  const [productos, setProductos] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchProductos = () => {
    fetch('/api/productos').then(res => res.json()).then(setProductos).catch(console.error);
  };

  useEffect(() => {
    fetchProductos();
  }, []);

  const handleDelete = async (id) => {
    if (window.confirm('¿Seguro que quieres eliminar este producto?')) {
      try {
        const res = await fetch(`/api/productos/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        fetchProductos();
        showToast('Producto eliminado correctamente');
      } catch {
        showToast('Error al eliminar el producto.', 'error');
      }
    }
  };

  const filteredProductos = productos.filter(p => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      p.nombreComercial?.toLowerCase().includes(q) ||
      p.idProducto?.toLowerCase().includes(q) ||
      p.ingredienteActivo?.toLowerCase().includes(q) ||
      p.proveedor?.toLowerCase().includes(q);
    const matchTipo = !filterTipo || p.tipo === filterTipo;
    return matchSearch && matchTipo;
  });

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="list-card" style={{ gridColumn: '1 / -1' }}>
        <h2>Inventario de Agroquímicos</h2>
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
        <ul className="info-list">
          {filteredProductos.map(p => {
            const stockBajo = p.stockActual <= p.stockMinimo;
            const total = (p.precioUnitario || 0) * (p.stockActual || 0) * (p.tipoCambio || 1);
            return (
              <li key={p.id}>
                <div className="product-list-info">
                  <div className="item-main-text">
                    <span className="product-id-tag">{p.idProducto}</span>
                    {p.nombreComercial}
                  </div>
                  <div className="item-sub-text">
                    {p.ingredienteActivo} · {p.tipo}
                    {p.proveedor && <> · <span className="product-proveedor">{p.proveedor}</span></>}
                  </div>
                  {p.precioUnitario > 0 && (
                    <div className="product-total-value">
                      Total: {formatCurrency(total, p.moneda)}
                    </div>
                  )}
                </div>
                <div className="product-list-right">
                  <span className={`stock-badge ${stockBajo ? 'stock-bajo' : 'stock-ok'}`}>
                    {p.stockActual} {p.unidad}
                  </span>
                  <div className="lote-actions">
                    <button
                      onClick={() => navigate('/ingreso-productos', { state: { editProducto: p } })}
                      className="icon-btn"
                      title="Editar"
                    >
                      <FiEdit size={18} />
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="icon-btn delete" title="Eliminar">
                      <FiTrash2 size={18} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {filteredProductos.length === 0 && (
          <p className="empty-state">
            {productos.length === 0
              ? 'No hay productos registrados.'
              : 'Sin resultados para la búsqueda actual.'}
          </p>
        )}
      </div>
    </div>
  );
}

export default ProductManagement;
