import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiEdit, FiTrash2, FiArrowLeft, FiSearch, FiX, FiAlertTriangle, FiBox, FiFilter } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import { usePageTitle } from '../../../hooks/usePageTitle';
import EmptyState from '../../../components/ui/EmptyState';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EditProductoModal from '../components/EditProductoModal';
import { TIPOS, formatCurrency } from '../lib/agroquimicos';
import { translateApiError } from '../../../lib/errorMessages';
import '../styles/agroquimicos.css';

const STOCK_CERO_MSG = 'Solo permitido para productos con existencias en cero.';
const EXISTENCIAS_PATH = '/bodega/agroquimicos/existencias';

function ProductosCatalogo() {
  usePageTitle('Catálogo de Productos');
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const toast = useToast();

  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [editProducto, setEditProducto] = useState(null);   // producto en edición (modal)
  const [confirmDelete, setConfirmDelete] = useState(null);  // producto a eliminar (modal)
  const [deleting, setDeleting] = useState(false);
  const [flashId, setFlashId] = useState(null);
  const flashTimer = useRef(null);

  const fetchProductos = useCallback(() => {
    setLoadError(false);
    apiFetch('/api/productos')
      .then(res => { if (!res.ok) throw new Error('fetch'); return res.json(); })
      .then(data => setProductos(Array.isArray(data) ? data : []))
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

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const p = confirmDelete;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/productos/${p.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(translateApiError(data, 'Error al eliminar el producto.')); return; }
      // Quita la fila localmente (optimista): evita re-fetch completo y parpadeo.
      setProductos(prev => prev.filter(x => x.id !== p.id));
      setConfirmDelete(null);
      toast.success(`"${p.nombreComercial}" eliminado correctamente.`);
    } catch {
      toast.error('Error al eliminar el producto.');
    } finally {
      setDeleting(false);
    }
  };

  const hasFilters = !!(searchQuery || filterTipo);

  const clearFilters = () => { setSearchQuery(''); setFilterTipo(''); };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return productos.filter(p => {
      const matchSearch = !q ||
        p.nombreComercial?.toLowerCase().includes(q) ||
        p.idProducto?.toLowerCase().includes(q) ||
        p.ingredienteActivo?.toLowerCase().includes(q) ||
        p.proveedor?.toLowerCase().includes(q);
      const matchTipo = !filterTipo || p.tipo === filterTipo;
      return matchSearch && matchTipo;
    });
  }, [productos, searchQuery, filterTipo]);

  if (!loading && loadError) {
    return (
      <div className="product-catalog-page">
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
    <div className="product-catalog-page">
      {loading && <div className="pg-page-loading" />}

      {!loading && (
        <>
          <div className="lote-page-title-block">
            <h2>Catálogo de Productos</h2>
            <p className="lote-page-hint">
              Vista de solo lectura de todos tus agroquímicos. Para reajustar stock o crear productos usá Existencias.
            </p>
          </div>

          <div className="catalog-top-bar">
            <button className="aur-chip catalog-back-btn" onClick={() => navigate(EXISTENCIAS_PATH)}>
              <FiArrowLeft size={15} /> Volver a Existencias
            </button>
            <div className="product-filters">
              <div className="catalog-search-wrap">
                <FiSearch size={15} className="catalog-search-icon" aria-hidden="true" />
                <input
                  type="text"
                  className="product-search-input"
                  placeholder="Buscar por nombre, ID, ingrediente o proveedor…"
                  aria-label="Buscar producto"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="catalog-search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label="Limpiar búsqueda"
                    title="Limpiar búsqueda"
                  >
                    <FiX size={14} />
                  </button>
                )}
              </div>
              <select
                className="product-filter-select"
                aria-label="Filtrar por tipo"
                value={filterTipo}
                onChange={e => setFilterTipo(e.target.value)}
              >
                <option value="">Todos los tipos</option>
                {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {hasFilters && (
                <button className="btn-toma-fisica" onClick={clearFilters} title="Limpiar filtros">
                  <FiX size={13} /> Limpiar filtros
                </button>
              )}
            </div>
            <span className="catalog-count">
              {filtered.length} producto{filtered.length !== 1 ? 's' : ''}
              {hasFilters ? (filtered.length !== 1 ? ' encontrados' : ' encontrado') : ''}
            </span>
          </div>

          {filtered.length > 0 && (
            <ul className="info-list catalog-list">
              {filtered.map(p => {
                const stockActual = Number(p.stockActual) || 0;
                const stockMinimo = Number(p.stockMinimo) || 0;
                const stockBajo = stockActual <= stockMinimo;
                const total = (Number(p.precioUnitario) || 0) * stockActual * (Number(p.tipoCambio) || 1);
                const hasStock = stockActual > 0;
                return (
                  <li key={p.id} className={flashId === p.id ? 'pg-row-flash' : undefined}>
                    <div className="product-list-info">
                      <div className="item-main-text">
                        <span className="product-id-tag">{p.idProducto}</span>
                        {p.nombreComercial}
                      </div>
                      <div className="item-sub-text">
                        {p.ingredienteActivo} · {p.tipo}
                        {p.proveedor && <> · <span className="product-proveedor">Prov: {p.proveedor}</span></>}
                      </div>
                      {Number(p.precioUnitario) > 0 && (
                        <div className="product-total-value">
                          Total: {formatCurrency(total, p.moneda)}
                        </div>
                      )}
                    </div>
                    <div className="product-list-right">
                      <span
                        className={`stock-badge ${stockBajo ? 'stock-bajo' : 'stock-ok'}`}
                        title={stockBajo ? `Stock bajo (mínimo: ${stockMinimo} ${p.unidad || ''})` : undefined}
                      >
                        {stockBajo && <FiAlertTriangle size={12} aria-hidden="true" style={{ marginRight: 4 }} />}
                        {stockActual} {p.unidad}
                      </span>
                      <div className="lote-actions">
                        <button
                          onClick={() => setEditProducto(p)}
                          className="aur-icon-btn"
                          aria-label={`Editar ${p.nombreComercial}`}
                          title="Editar"
                        >
                          <FiEdit size={18} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(p)}
                          className="aur-icon-btn aur-icon-btn--danger"
                          disabled={hasStock}
                          aria-label={`Eliminar ${p.nombreComercial}`}
                          title={hasStock ? STOCK_CERO_MSG : 'Eliminar'}
                        >
                          <FiTrash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {filtered.length === 0 && (
            hasFilters ? (
              <EmptyState
                icon={FiFilter}
                title="Sin resultados para la búsqueda actual"
                subtitle="Ajustá los filtros o limpiá la búsqueda para ver más productos."
                action={<button className="aur-btn-pill" onClick={clearFilters}>Limpiar filtros</button>}
              />
            ) : (
              <EmptyState
                icon={FiBox}
                title="No hay productos registrados"
                subtitle="Registrá el primer producto desde Existencias."
                action={<button className="aur-btn-pill" onClick={() => navigate(EXISTENCIAS_PATH)}>Ir a Existencias</button>}
              />
            )
          )}
        </>
      )}

      {editProducto && (
        <EditProductoModal
          producto={editProducto}
          onClose={() => setEditProducto(null)}
          onSaved={(data) => {
            setEditProducto(null);
            fetchProductos();
            flashRow(editProducto.id);
            toast.success(`"${data.nombreComercial}" actualizado correctamente.`);
          }}
        />
      )}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar producto"
          body={`¿Eliminar "${confirmDelete.nombreComercial}" permanentemente? Stock actual: ${Number(confirmDelete.stockActual) || 0} ${confirmDelete.unidad || ''}. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          loading={deleting}
          loadingLabel="Eliminando…"
          onConfirm={handleConfirmDelete}
          onCancel={() => { if (!deleting) setConfirmDelete(null); }}
        />
      )}
    </div>
  );
}

export default ProductosCatalogo;
