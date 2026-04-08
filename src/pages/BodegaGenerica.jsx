import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FiBox, FiTool, FiTruck, FiDroplet, FiPackage,
  FiPlus, FiEdit2, FiTrash2, FiArrowUp, FiArrowDown,
  FiX, FiAlertTriangle, FiList, FiArchive, FiPaperclip,
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

const EMPTY_ITEM     = { nombre: '', unidad: '', stockActual: '', stockMinimo: '', descripcion: '', total: '' };
const EMPTY_MOV      = { itemId: '', tipo: 'salida',  cantidad: '', nota: '', loteId: '', laborId: '', activoId: '', operarioId: '' };
const EMPTY_ENTRADA  = { itemId: '', tipo: 'entrada', cantidad: '', factura: '', oc: '', total: '' };

const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    resolve({ base64: dataUrl.split(',')[1], mediaType: file.type });
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

function BodegaGenerica() {
  const { bodegaId } = useParams();
  const navigate = useNavigate();
  const apiFetch = useApiFetch();

  const [bodega,   setBodega]   = useState(null);
  const [items,    setItems]    = useState([]);
  const [movs,     setMovs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState('existencias');

  // Datos para selects del formulario de movimientos
  const [lotes,      setLotes]      = useState([]);
  const [usuarios,   setUsuarios]   = useState([]);
  const [fichas,     setFichas]     = useState([]);
  const [maquinaria, setMaquinaria] = useState([]);
  const [labores,    setLabores]    = useState([]);

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
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/hr/fichas').then(r => r.json()),
      apiFetch('/api/maquinaria').then(r => r.json()),
      apiFetch('/api/labores').then(r => r.json()),
    ])
      .then(([bodegas, itemsData, lotesData, usuariosData, fichasData, maquinariaData, laboresData]) => {
        const b = bodegas.find(x => x.id === bodegaId);
        if (!b || b.tipo === 'agroquimicos') { navigate('/'); return; }
        setBodega(b);
        setItems(itemsData);
        setLotes(Array.isArray(lotesData) ? lotesData : []);
        setUsuarios(Array.isArray(usuariosData) ? usuariosData : []);
        setFichas(Array.isArray(fichasData) ? fichasData : []);
        setMaquinaria(Array.isArray(maquinariaData) ? maquinariaData : []);
        setLabores(Array.isArray(laboresData) ? laboresData : []);
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
  const [movForm,     setMovForm]     = useState(EMPTY_MOV);
  const [entradaForm, setEntradaForm] = useState(EMPTY_ENTRADA);
  const [facturaFile, setFacturaFile] = useState(null);

  const openMovModal = (itemId, tipo) => {
    if (tipo === 'entrada') {
      setEntradaForm({ ...EMPTY_ENTRADA, itemId });
      setFacturaFile(null);
    } else {
      setMovForm({ ...EMPTY_MOV, itemId });
    }
    setMovModal({ itemId, tipo });
  };

  const handleSaveEntrada = async () => {
    if (!entradaForm.cantidad || parseFloat(entradaForm.cantidad) <= 0) {
      showToast('La cantidad debe ser mayor a cero.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...entradaForm };
      if (facturaFile) {
        const { base64, mediaType } = await readFileAsBase64(facturaFile);
        payload.imageBase64 = base64;
        payload.mediaType   = mediaType;
      }
      const res = await apiFetch(`/api/bodegas/${bodegaId}/movimientos`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.message, 'error');
        return;
      }
      showToast('Entrada registrada.');
      setMovModal(null);
      fetchAll();
      if (tab === 'movimientos') fetchMovs();
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMov = async () => {
    if (!movForm.cantidad || parseFloat(movForm.cantidad) <= 0) {
      showToast('La cantidad debe ser mayor a cero.', 'error');
      return;
    }
    if (!movForm.activoId) {
      showToast('El campo Activo es obligatorio.', 'error');
      return;
    }
    if (!movForm.operarioId) {
      showToast('El campo Operario es obligatorio.', 'error');
      return;
    }
    // Resolver nombres para guardar junto con los IDs
    const loteSeleccionado    = lotes.find(l => l.id === movForm.loteId);
    const laborSeleccionada   = labores.find(l => l.id === movForm.laborId);
    const activoSeleccionado  = maquinaria.find(m => m.id === movForm.activoId);
    const operarioSeleccionado = usuarios.find(u => u.id === movForm.operarioId);
    const payload = {
      ...movForm,
      loteNombre:    loteSeleccionado?.nombreLote || '',
      laborNombre:   laborSeleccionada ? `${laborSeleccionada.codigo ? laborSeleccionada.codigo + ' - ' : ''}${laborSeleccionada.descripcion}` : '',
      activoNombre:  activoSeleccionado?.descripcion || '',
      operarioNombre: operarioSeleccionado?.nombre || '',
    };
    setSaving(true);
    try {
      const res = await apiFetch(`/api/bodegas/${bodegaId}/movimientos`, {
        method: 'POST',
        body: JSON.stringify(payload),
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

  // Empleados = usuarios que tienen ficha registrada, ordenados por nombre
  const empleados = useMemo(() => {
    const fichaIds = new Set(fichas.map(f => f.userId));
    return usuarios
      .filter(u => fichaIds.has(u.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [fichas, usuarios]);

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
                  <th className="text-right">Total</th>
                  <th className="text-right">Precio unitario</th>
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
                      <td className="text-right">{item.total != null && item.total !== '' ? fmt(item.total) : '—'}</td>
                      <td className="text-right">
                        {item.total != null && item.total !== '' && item.stockActual > 0
                          ? fmt(item.total / item.stockActual)
                          : '—'}
                      </td>
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
                  <th>Factura</th>
                  <th>OC</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Total salida</th>
                  <th>Activo</th>
                  <th>Operario</th>
                  <th>Lote</th>
                  <th>Labor</th>
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
                    <td className="bg-nota">
                      {m.facturaUrl
                        ? <a href={m.facturaUrl} target="_blank" rel="noopener noreferrer" className="bg-link">{m.factura || 'Ver'}</a>
                        : (m.factura || '—')}
                    </td>
                    <td className="bg-nota">{m.oc || '—'}</td>
                    <td className="text-right bg-nota">{m.total != null && m.total !== '' ? fmt(m.total) : '—'}</td>
                    <td className="text-right bg-nota">{m.totalSalida != null ? fmt(m.totalSalida) : '—'}</td>
                    <td className="bg-nota">{m.activoNombre || '—'}</td>
                    <td className="bg-nota">{m.operarioNombre || '—'}</td>
                    <td className="bg-nota">{m.loteNombre || '—'}</td>
                    <td className="bg-nota">{m.laborNombre || '—'}</td>
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
              <label className="lm-label">Total (valor inventario)</label>
              <input
                className="lm-input"
                type="number"
                min="0"
                step="0.01"
                value={itemModal.data.total}
                onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, total: e.target.value } }))}
                placeholder="0.00"
              />
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

      {/* ── Modal Entrada ── */}
      {movModal?.tipo === 'entrada' && (
        <div className="lm-modal-backdrop" onClick={() => setMovModal(null)}>
          <div className="lm-modal lm-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="lm-modal-header">
              <h3>
                <FiArrowDown size={16} /> Registrar Entrada
                {itemForMov && <span className="bg-modal-item"> — {itemForMov.nombre}</span>}
              </h3>
              <button className="lm-modal-close" onClick={() => setMovModal(null)}><FiX size={18} /></button>
            </div>
            <div className="lm-modal-body">
              <div className="bg-form-row">
                <div>
                  <label className="lm-label">Factura</label>
                  <input
                    className="lm-input"
                    value={entradaForm.factura}
                    onChange={e => setEntradaForm(f => ({ ...f, factura: e.target.value }))}
                    placeholder="Nº de factura"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="lm-label">OC</label>
                  <input
                    className="lm-input"
                    value={entradaForm.oc}
                    onChange={e => setEntradaForm(f => ({ ...f, oc: e.target.value }))}
                    placeholder="Orden de compra"
                  />
                </div>
              </div>
              <div className="bg-form-row">
                <div>
                  <label className="lm-label">
                    Cantidad{itemForMov?.unidad ? ` (${itemForMov.unidad})` : ''} *
                  </label>
                  <input
                    className="lm-input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={entradaForm.cantidad}
                    onChange={e => setEntradaForm(f => ({ ...f, cantidad: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="lm-label">Total</label>
                  <input
                    className="lm-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={entradaForm.total}
                    onChange={e => setEntradaForm(f => ({ ...f, total: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              </div>
              {itemForMov && (
                <p className="bg-stock-hint">
                  Stock actual: <strong>{fmt(itemForMov.stockActual)} {itemForMov.unidad}</strong>
                </p>
              )}
              <label className="lm-label">Adjuntar factura</label>
              <label className="bg-file-label">
                <FiPaperclip size={15} />
                {facturaFile ? facturaFile.name : 'Seleccionar archivo…'}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  style={{ display: 'none' }}
                  onChange={e => setFacturaFile(e.target.files[0] || null)}
                />
              </label>
              {facturaFile && (
                <button
                  className="bg-file-clear"
                  type="button"
                  onClick={() => setFacturaFile(null)}
                >
                  <FiX size={13} /> Quitar archivo
                </button>
              )}
            </div>
            <div className="lm-modal-footer">
              <button className="lm-btn-secondary" onClick={() => setMovModal(null)} disabled={saving}>Cancelar</button>
              <button className="lm-btn-primary" onClick={handleSaveEntrada} disabled={saving}>
                {saving ? 'Guardando...' : 'Registrar entrada'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Salida ── */}
      {movModal?.tipo === 'salida' && (
        <div className="lm-modal-backdrop" onClick={() => setMovModal(null)}>
          <div className="lm-modal lm-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="lm-modal-header">
              <h3>
                <FiArrowUp size={16} /> Registrar Salida
                {itemForMov && <span className="bg-modal-item"> — {itemForMov.nombre}</span>}
              </h3>
              <button className="lm-modal-close" onClick={() => setMovModal(null)}><FiX size={18} /></button>
            </div>
            <div className="lm-modal-body">
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

              <div className="bg-form-row">
                <div>
                  <label className="lm-label">Activo *</label>
                  <select
                    className="lm-input"
                    value={movForm.activoId}
                    onChange={e => setMovForm(f => ({ ...f, activoId: e.target.value }))}
                  >
                    <option value="">— Seleccionar —</option>
                    {maquinaria
                      .filter(m => m.tipo?.toUpperCase() !== 'IMPLEMENTO')
                      .map(m => (
                        <option key={m.id} value={m.id}>
                          {m.codigo ? `${m.codigo} - ` : ''}{m.descripcion}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="lm-label">Operario *</label>
                  <select
                    className="lm-input"
                    value={movForm.operarioId}
                    onChange={e => setMovForm(f => ({ ...f, operarioId: e.target.value }))}
                  >
                    <option value="">— Seleccionar —</option>
                    {empleados.map(u => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="bg-form-row">
                <div>
                  <label className="lm-label">Lote</label>
                  <select
                    className="lm-input"
                    value={movForm.loteId}
                    onChange={e => setMovForm(f => ({ ...f, loteId: e.target.value }))}
                  >
                    <option value="">— Ninguno —</option>
                    {lotes.map(l => (
                      <option key={l.id} value={l.id}>{l.nombreLote}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="lm-label">Labor</label>
                  <select
                    className="lm-input"
                    value={movForm.laborId}
                    onChange={e => setMovForm(f => ({ ...f, laborId: e.target.value }))}
                  >
                    <option value="">— Ninguna —</option>
                    {labores.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.codigo ? `${l.codigo} - ` : ''}{l.descripcion}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="lm-label">Nota (opcional)</label>
              <input
                className="lm-input"
                value={movForm.nota}
                onChange={e => setMovForm(f => ({ ...f, nota: e.target.value }))}
                placeholder="Motivo, proveedor, etc."
              />
            </div>
            <div className="lm-modal-footer">
              <button className="lm-btn-secondary" onClick={() => setMovModal(null)} disabled={saving}>Cancelar</button>
              <button className="lm-btn-primary" onClick={handleSaveMov} disabled={saving}>
                {saving ? 'Guardando...' : 'Registrar salida'}
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
