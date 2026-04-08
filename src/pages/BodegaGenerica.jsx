import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FiBox, FiTool, FiTruck, FiDroplet, FiPackage,
  FiPlus, FiEdit2, FiTrash2, FiArrowUp, FiArrowDown,
  FiX, FiAlertTriangle, FiList, FiArchive,
} from 'react-icons/fi';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import { useApiFetch } from '../hooks/useApiFetch';
import './BodegaGenerica.css';

// ── Icon map ──────────────────────────────────────────────────────────────────
const ICON_MAP = { FiBox, FiTool, FiTruck, FiDroplet, FiPackage };
const BodegaIcon = ({ iconKey, size = 20 }) => {
  const Icon = ICON_MAP[iconKey] || FiBox;
  return <Icon size={size} />;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => (n ?? 0).toLocaleString('es', { maximumFractionDigits: 2 });
const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const EMPTY_ITEM = { nombre: '', unidad: '', stockActual: '', stockMinimo: '', descripcion: '' };
const EMPTY_MOV  = { itemId: '', tipo: 'entrada', cantidad: '', nota: '' };

function BodegaGenerica() {
  const { bodegaId } = useParams();
  const navigate = useNavigate();
  const apiFetch = useApiFetch();

  const [bodega,   setBodega]   = useState(null);
  const [items,    setItems]    = useState([]);
  const [movs,     setMovs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState('existencias');

  // Modals
  const [itemModal,  setItemModal]  = useState(null);  // null | {mode:'create'|'edit', data}
  const [movModal,   setMovModal]   = useState(null);  // null | {itemId, tipo:'entrada'|'salida'}
  const [confirmDel, setConfirmDel] = useState(null);  // null | {type:'item'|'mov', id, label}

  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      apiFetch('/api/bodegas').then(r => r.json()),
      apiFetch(`/api/bodegas/${bodegaId}/items`).then(r => r.json()),
    ])
      .then(([bodegas, itemsData]) => {
        const b = bodegas.find(x => x.id === bodegaId);
        if (!b || b.tipo === 'agroquimicos') { navigate('/'); return; }
        setBodega(b);
        setItems(itemsData);
      })
      .catch(() => showToast('Error al cargar datos.', 'error'))
      .finally(() => setLoading(false));
  };

  const fetchMovs = () => {
    apiFetch(`/api/bodegas/${bodegaId}/movimientos`)
      .then(r => r.json())
      .then(setMovs)
      .catch(() => showToast('Error al cargar movimientos.', 'error'));
  };

  useEffect(() => { fetchAll(); }, [bodegaId]);
  useEffect(() => { if (tab === 'movimientos') fetchMovs(); }, [tab, bodegaId]);

  // ── Item CRUD ─────────────────────────────────────────────────────────────
  const handleSaveItem = async () => {
    const { mode, data } = itemModal;
    if (!data.nombre?.trim()) { showToast('El nombre es requerido.', 'error'); return; }
    setSaving(true);
    try {
      const method = mode === 'edit' ? 'PUT' : 'POST';
      const url = mode === 'edit'
        ? `/api/bodegas/${bodegaId}/items/${data.id}`
        : `/api/bodegas/${bodegaId}/items`;
      const res = await apiFetch(url, { method, body: JSON.stringify(data) });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.message, 'error');
        return;
      }
      showToast(mode === 'edit' ? 'Producto actualizado.' : 'Producto agregado.');
      setItemModal(null);
      fetchAll();
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (id) => {
    try {
      const res = await apiFetch(`/api/bodegas/${bodegaId}/items/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.message, 'error');
        return;
      }
      showToast('Producto eliminado.');
      fetchAll();
    } catch {
      showToast('Error de conexión.', 'error');
    }
  };

  // ── Movimientos ───────────────────────────────────────────────────────────
  const [movForm, setMovForm] = useState(EMPTY_MOV);

  const openMovModal = (itemId, tipo) => {
    setMovForm({ ...EMPTY_MOV, itemId, tipo });
    setMovModal({ itemId, tipo });
  };

  const handleSaveMov = async () => {
    if (!movForm.cantidad || parseFloat(movForm.cantidad) <= 0) {
      showToast('La cantidad debe ser mayor a cero.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/bodegas/${bodegaId}/movimientos`, {
        method: 'POST',
        body: JSON.stringify(movForm),
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.message, 'error');
        return;
      }
      showToast(movForm.tipo === 'entrada' ? 'Entrada registrada.' : 'Salida registrada.');
      setMovModal(null);
      fetchAll();
      if (tab === 'movimientos') fetchMovs();
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeItems = useMemo(() => items.filter(i => i.activo !== false), [items]);
  const lowStock    = useMemo(() => activeItems.filter(i => i.stockActual <= i.stockMinimo && i.stockMinimo > 0), [activeItems]);

  if (loading) return <div className="lm-loading">Cargando bodega...</div>;
  if (!bodega) return null;

  const itemForMov = movModal ? items.find(i => i.id === movModal.itemId) : null;

  return (
    <div className="lm-container">
      {/* ── Header ── */}
      <div className="lm-header">
        <div className="lm-header-left">
          <div className="bg-header-icon">
            <BodegaIcon iconKey={bodega.icono} size={24} />
          </div>
          <div>
            <h2 className="lm-title">{bodega.nombre}</h2>
            {lowStock.length > 0 && (
              <span className="bg-low-alert">
                <FiAlertTriangle size={13} /> {lowStock.length} bajo stock mínimo
              </span>
            )}
          </div>
        </div>
        {tab === 'existencias' && (
          <button className="lm-btn-primary" onClick={() => setItemModal({ mode: 'create', data: { ...EMPTY_ITEM } })}>
            <FiPlus size={16} /> Agregar producto
          </button>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="bg-tabs">
        <button className={`bg-tab${tab === 'existencias' ? ' active' : ''}`} onClick={() => setTab('existencias')}>
          <FiArchive size={15} /> Existencias
        </button>
        <button className={`bg-tab${tab === 'movimientos' ? ' active' : ''}`} onClick={() => setTab('movimientos')}>
          <FiList size={15} /> Movimientos
        </button>
      </div>

      {/* ── Existencias ── */}
      {tab === 'existencias' && (
        activeItems.length === 0 ? (
          <div className="empty-state">
            <FiBox size={36} />
            <p>Esta bodega no tiene productos registrados.</p>
            <button className="lm-btn-primary" onClick={() => setItemModal({ mode: 'create', data: { ...EMPTY_ITEM } })}>
              <FiPlus size={14} /> Agregar primer producto
            </button>
          </div>
        ) : (
          <div className="bg-table-wrap">
            <table className="bg-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Unidad</th>
                  <th className="text-right">Stock actual</th>
                  <th className="text-right">Stock mínimo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {activeItems.map(item => {
                  const low = item.stockMinimo > 0 && item.stockActual <= item.stockMinimo;
                  return (
                    <tr key={item.id} className={low ? 'bg-row-low' : ''}>
                      <td>
                        <span className="bg-item-name">{item.nombre}</span>
                        {item.descripcion && <span className="bg-item-desc">{item.descripcion}</span>}
                      </td>
                      <td>{item.unidad || '—'}</td>
                      <td className="text-right">
                        <span className={`bg-stock${low ? ' low' : ''}`}>{fmt(item.stockActual)}</span>
                        {low && <FiAlertTriangle size={12} className="bg-warn-icon" />}
                      </td>
                      <td className="text-right">{fmt(item.stockMinimo)}</td>
                      <td>
                        <div className="bg-row-actions">
                          <button className="bg-btn-mov entrada" onClick={() => openMovModal(item.id, 'entrada')} title="Registrar entrada">
                            <FiArrowDown size={14} /> Entrada
                          </button>
                          <button className="bg-btn-mov salida" onClick={() => openMovModal(item.id, 'salida')} title="Registrar salida">
                            <FiArrowUp size={14} /> Salida
                          </button>
                          <button className="ba-btn-icon" onClick={() => setItemModal({ mode: 'edit', data: { ...item } })} title="Editar">
                            <FiEdit2 size={14} />
                          </button>
                          <button className="ba-btn-icon ba-btn-danger" onClick={() => setConfirmDel({ type: 'item', id: item.id, label: item.nombre })} title="Eliminar">
                            <FiTrash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Movimientos ── */}
      {tab === 'movimientos' && (
        movs.length === 0 ? (
          <div className="empty-state">
            <FiList size={36} />
            <p>No hay movimientos registrados aún.</p>
          </div>
        ) : (
          <div className="bg-table-wrap">
            <table className="bg-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Stock anterior</th>
                  <th className="text-right">Stock resultante</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {movs.map(m => (
                  <tr key={m.id}>
                    <td className="bg-date">{fmtDate(m.timestamp)}</td>
                    <td>{m.itemNombre}</td>
                    <td>
                      <span className={`bg-badge ${m.tipo}`}>
                        {m.tipo === 'entrada' ? <FiArrowDown size={12} /> : <FiArrowUp size={12} />}
                        {m.tipo === 'entrada' ? 'Entrada' : 'Salida'}
                      </span>
                    </td>
                    <td className="text-right">{fmt(m.cantidad)}</td>
                    <td className="text-right">{fmt(m.stockAntes)}</td>
                    <td className="text-right">{fmt(m.stockDespues)}</td>
                    <td className="bg-nota">{m.nota || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Modal Ítem ── */}
      {itemModal && (
        <div className="lm-modal-backdrop" onClick={() => setItemModal(null)}>
          <div className="lm-modal" onClick={e => e.stopPropagation()}>
            <div className="lm-modal-header">
              <h3>{itemModal.mode === 'edit' ? 'Editar producto' : 'Agregar producto'}</h3>
              <button className="lm-modal-close" onClick={() => setItemModal(null)}><FiX size={18} /></button>
            </div>
            <div className="lm-modal-body">
              <label className="lm-label">Nombre *</label>
              <input
                className="lm-input"
                value={itemModal.data.nombre}
                onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, nombre: e.target.value } }))}
                placeholder="Ej: Diesel"
                autoFocus
              />
              <div className="bg-form-row">
                <div>
                  <label className="lm-label">Unidad</label>
                  <input
                    className="lm-input"
                    value={itemModal.data.unidad}
                    onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, unidad: e.target.value } }))}
                    placeholder="Ej: litros, kg, unidades"
                  />
                </div>
                <div>
                  <label className="lm-label">Stock mínimo</label>
                  <input
                    className="lm-input"
                    type="number"
                    min="0"
                    value={itemModal.data.stockMinimo}
                    onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, stockMinimo: e.target.value } }))}
                    placeholder="0"
                  />
                </div>
              </div>
              {itemModal.mode === 'create' && (
                <>
                  <label className="lm-label">Stock inicial</label>
                  <input
                    className="lm-input"
                    type="number"
                    min="0"
                    value={itemModal.data.stockActual}
                    onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, stockActual: e.target.value } }))}
                    placeholder="0"
                  />
                </>
              )}
              <label className="lm-label">Descripción (opcional)</label>
              <input
                className="lm-input"
                value={itemModal.data.descripcion}
                onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, descripcion: e.target.value } }))}
                placeholder="Notas adicionales"
              />
            </div>
            <div className="lm-modal-footer">
              <button className="lm-btn-secondary" onClick={() => setItemModal(null)} disabled={saving}>Cancelar</button>
              <button className="lm-btn-primary" onClick={handleSaveItem} disabled={saving}>
                {saving ? 'Guardando...' : (itemModal.mode === 'edit' ? 'Guardar' : 'Agregar')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Movimiento ── */}
      {movModal && (
        <div className="lm-modal-backdrop" onClick={() => setMovModal(null)}>
          <div className="lm-modal lm-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="lm-modal-header">
              <h3>
                {movForm.tipo === 'entrada' ? 'Registrar Entrada' : 'Registrar Salida'}
                {itemForMov && <span className="bg-modal-item"> — {itemForMov.nombre}</span>}
              </h3>
              <button className="lm-modal-close" onClick={() => setMovModal(null)}><FiX size={18} /></button>
            </div>
            <div className="lm-modal-body">
              <div className="bg-tipo-toggle">
                <button
                  className={`bg-tipo-btn${movForm.tipo === 'entrada' ? ' active entrada' : ''}`}
                  onClick={() => setMovForm(f => ({ ...f, tipo: 'entrada' }))}
                  type="button"
                >
                  <FiArrowDown size={15} /> Entrada
                </button>
                <button
                  className={`bg-tipo-btn${movForm.tipo === 'salida' ? ' active salida' : ''}`}
                  onClick={() => setMovForm(f => ({ ...f, tipo: 'salida' }))}
                  type="button"
                >
                  <FiArrowUp size={15} /> Salida
                </button>
              </div>
              <label className="lm-label">
                Cantidad{itemForMov?.unidad ? ` (${itemForMov.unidad})` : ''} *
              </label>
              <input
                className="lm-input"
                type="number"
                min="0.01"
                step="0.01"
                value={movForm.cantidad}
                onChange={e => setMovForm(f => ({ ...f, cantidad: e.target.value }))}
                placeholder="0"
                autoFocus
              />
              {itemForMov && (
                <p className="bg-stock-hint">
                  Stock actual: <strong>{fmt(itemForMov.stockActual)} {itemForMov.unidad}</strong>
                </p>
              )}
              <label className="lm-label">Nota (opcional)</label>
              <input
                className="lm-input"
                value={movForm.nota}
                onChange={e => setMovForm(f => ({ ...f, nota: e.target.value }))}
                placeholder="Motivo, proveedor, etc."
                onKeyDown={e => e.key === 'Enter' && handleSaveMov()}
              />
            </div>
            <div className="lm-modal-footer">
              <button className="lm-btn-secondary" onClick={() => setMovModal(null)} disabled={saving}>Cancelar</button>
              <button className="lm-btn-primary" onClick={handleSaveMov} disabled={saving}>
                {saving ? 'Guardando...' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <ConfirmModal
          title="Eliminar producto"
          message={`¿Eliminar "${confirmDel.label}"? Solo es posible si no tiene movimientos registrados.`}
          onConfirm={() => { handleDeleteItem(confirmDel.id); setConfirmDel(null); }}
          onCancel={() => setConfirmDel(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default BodegaGenerica;
