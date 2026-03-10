import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiEdit, FiTrash2, FiArrowLeft } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './ProductManagement.css';
import Toast from '../components/Toast';

const TIPOS = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];

function formatCurrency(value, moneda) {
  return `${Number(value).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda || ''}`;
}

function ProductCatalog() {
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const [productos, setProductos] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchProductos = () => {
    apiFetch('/api/productos').then(res => res.json()).then(setProductos).catch(console.error);
  };

  useEffect(() => { fetchProductos(); }, []);

  const handleEdit = (p) => {
    navigate('/productos', { state: { editProducto: p } });
  };

  const handleDelete = async (id) => {
    if (window.confirm('¿Seguro que quieres eliminar este producto?')) {
      try {
        const res = await apiFetch(`/api/productos/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        fetchProductos();
        showToast('Producto eliminado correctamente');
      } catch {
        showToast('Error al eliminar el producto.', 'error');
      }
    }
  };

  const filtered = productos.filter(p => {
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
    <div className="product-catalog-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="catalog-top-bar">
        <button className="btn btn-secondary catalog-back-btn" onClick={() => navigate('/productos')}>
          <FiArrowLeft size={15} /> Volver a Bodega
        </button>
        <div className="product-filters">
          <input
            type="text"
            className="product-search-input"
            placeholder="Buscar por nombre, ID o ingrediente…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            autoFocus
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
        <span className="catalog-count">
          {filtered.length} producto{filtered.length !== 1 ? 's' : ''}
          {(searchQuery || filterTipo) ? ' encontrados' : ''}
        </span>
      </div>

      <ul className="info-list catalog-list">
        {filtered.map(p => {
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
                  <button onClick={() => handleEdit(p)} className="icon-btn" title="Editar">
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

      {filtered.length === 0 && (
        <p className="empty-state">
          {productos.length === 0
            ? 'No hay productos registrados.'
            : 'Sin resultados para la búsqueda actual.'}
        </p>
      )}
    </div>
  );
}

export default ProductCatalog;
