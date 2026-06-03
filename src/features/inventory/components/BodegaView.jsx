import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiBox, FiPlus, FiEdit2, FiTrash2, FiArrowUp, FiArrowDown,
  FiAlertTriangle, FiList, FiArchive, FiPaperclip, FiX,
} from 'react-icons/fi';
import AuroraModal from '../../../components/AuroraModal';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import UnidadCombobox from './UnidadCombobox';
import MovimientosTable from './MovimientosTable';
import {
  ICON_MAP, fmt, avgUnitCost, parseDecimal, readFileAsBase64,
  EMPTY_ITEM, EMPTY_MOV, EMPTY_ENTRADA, MAX_FILE_SIZE,
  loadVisibleCols, LS_MOV_COLS,
} from '../lib/bodega';
import '../styles/bodega-generica.css';

const BodegaIcon = ({ iconKey, size = 20 }) => {
  const Icon = ICON_MAP[iconKey] || FiBox;
  return <Icon size={size} />;
};

/**
 * Vista compartida de bodega (combustibles + genérica). Las páginas wrapper
 * solo difieren en cómo resuelven la bodega y en el copy, así que se inyecta:
 *   - resolveBodega(bodegas, navigate) → bodega | null   (puede redirigir)
 *   - emptyStockTitle  string · copy del empty-state de existencias vacías
 *   - itemNombrePlaceholder string · placeholder del nombre en el form
 */
export default function BodegaView({ resolveBodega, emptyStockTitle, itemNombrePlaceholder }) {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const navigate = useNavigate();

  const [bodega,   setBodega]   = useState(null);
  const [items,    setItems]    = useState([]);
  const [movs,     setMovs]     = useState([]);
  const [loading,  setLoading]  = useState(true); // solo el primer mount
  const [tab,      setTab]      = useState('existencias');

  const bodegaId = bodega?.id;
  const movsLoaded = useRef(false);

  // Catálogos para los selects del form de movimientos (se cargan una vez).
  const [lotes,      setLotes]      = useState([]);
  const [usuarios,   setUsuarios]   = useState([]);
  const [fichas,     setFichas]     = useState([]);
  const [maquinaria, setMaquinaria] = useState([]);
  const [labores,    setLabores]    = useState([]);

  // Modals
  const [itemModal,  setItemModal]  = useState(null);  // null | {mode, data}
  const [movModal,   setMovModal]   = useState(null);  // null | {itemId, tipo}
  const [confirmDel, setConfirmDel] = useState(null);  // null | {id, label}

  const [saving, setSaving] = useState(false);

  // Visibilidad de columnas de movimientos (persistida en localStorage).
  const [movVisibleCols, setMovVisibleCols] = useState(loadVisibleCols);
  const toggleMovCol = useCallback((key) => {
    setMovVisibleCols(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(LS_MOV_COLS, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // ── Fetch ───────────────────────────────────────────────────────────────
  // Carga inicial: bodega + items + catálogos. Solo togglea `loading` la 1ª vez.
  const fetchAll = useCallback((initial = false) => {
    if (initial) setLoading(true);
    return Promise.all([
      apiFetch('/api/bodegas').then(r => r.json()),
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/users/lite').then(r => r.json()),
      apiFetch('/api/hr/fichas').then(r => r.json()),
      apiFetch('/api/maquinaria').then(r => r.json()),
      apiFetch('/api/labores').then(r => r.json()),
    ])
      .then(async ([bodegas, lotesData, usuariosData, fichasData, maquinariaData, laboresData]) => {
        const b = resolveBodega(Array.isArray(bodegas) ? bodegas : [], navigate);
        if (!b) return; // resolveBodega ya redirigió
        setBodega(b);
        const itemsData = await apiFetch(`/api/bodegas/${b.id}/items`).then(r => r.json());
        setItems(Array.isArray(itemsData) ? itemsData : []);
        setLotes(Array.isArray(lotesData) ? lotesData : []);
        setUsuarios(Array.isArray(usuariosData) ? usuariosData : []);
        setFichas(Array.isArray(fichasData) ? fichasData : []);
        setMaquinaria(Array.isArray(maquinariaData) ? maquinariaData : []);
        setLabores(Array.isArray(laboresData) ? laboresData : []);
      })
      .catch(() => toast.error('Error al cargar datos.'))
      .finally(() => { if (initial) setLoading(false); });
  }, [apiFetch, resolveBodega, toast, navigate]);

  // Refetch silencioso de SOLO los items (tras save/delete/movimiento).
  const refreshItems = useCallback(() => {
    if (!bodegaId) return Promise.resolve();
    return apiFetch(`/api/bodegas/${bodegaId}/items`)
      .then(r => r.json())
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Error al actualizar existencias.'));
  }, [apiFetch, bodegaId, toast]);

  const fetchMovs = useCallback(() => {
    if (!bodegaId) return Promise.resolve();
    return apiFetch(`/api/bodegas/${bodegaId}/movimientos`)
      .then(r => r.json())
      .then(data => { setMovs(Array.isArray(data) ? data : []); movsLoaded.current = true; })
      .catch(() => toast.error('Error al cargar movimientos.'));
  }, [apiFetch, bodegaId, toast]);

  useEffect(() => { fetchAll(true); }, [fetchAll]);

  // La pestaña de movimientos se pide una vez; se invalida tras registrar uno.
  useEffect(() => {
    if (tab === 'movimientos' && bodegaId && !movsLoaded.current) fetchMovs();
  }, [tab, bodegaId, fetchMovs]);

  const afterMovChange = useCallback(async () => {
    await refreshItems();
    movsLoaded.current = false;
    if (tab === 'movimientos') await fetchMovs();
  }, [refreshItems, fetchMovs, tab]);

  // ── Item CRUD ─────────────────────────────────────────────────────────────
  const handleSaveItem = async () => {
    const { mode, data } = itemModal;
    if (!data.nombre?.trim()) { toast.error('El nombre es requerido.'); return; }
    if (data.nombre.trim().length > 200) { toast.error('Nombre demasiado largo (máx 200).'); return; }
    if (data.descripcion && data.descripcion.length > 500) { toast.error('Descripción demasiado larga (máx 500).'); return; }
    if (data.unidad && data.unidad.length > 50) { toast.error('Unidad demasiado larga (máx 50).'); return; }
    const stockAct = parseDecimal(data.stockActual);
    const stockMin = parseDecimal(data.stockMinimo);
    const totalVal = data.total !== '' && data.total !== undefined ? parseDecimal(data.total) : null;
    if (data.stockActual !== '' && (isNaN(stockAct) || stockAct < 0)) { toast.error('Stock actual debe ser un número ≥ 0.'); return; }
    if (data.stockMinimo !== '' && (isNaN(stockMin) || stockMin < 0)) { toast.error('Stock mínimo debe ser un número ≥ 0.'); return; }
    if (totalVal !== null && (isNaN(totalVal) || totalVal < 0)) { toast.error('Total debe ser un número ≥ 0.'); return; }
    setSaving(true);
    try {
      const method = mode === 'edit' ? 'PUT' : 'POST';
      const url = mode === 'edit'
        ? `/api/bodegas/${bodegaId}/items/${data.id}`
        : `/api/bodegas/${bodegaId}/items`;
      const res = await apiFetch(url, { method, body: JSON.stringify(data) });
      if (!res.ok) { const err = await res.json(); toast.error(err.message); return; }
      toast.success(mode === 'edit' ? 'Producto actualizado.' : 'Producto agregado.');
      setItemModal(null);
      await refreshItems();
    } catch {
      toast.error('Error de conexión.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (id) => {
    try {
      const res = await apiFetch(`/api/bodegas/${bodegaId}/items/${id}`, { method: 'DELETE' });
      if (!res.ok) { const err = await res.json(); toast.error(err.message); return; }
      toast.success('Producto eliminado.');
      await refreshItems();
    } catch {
      toast.error('Error de conexión.');
    }
  };

  // ── Movimientos ───────────────────────────────────────────────────────────
  const [movForm,     setMovForm]     = useState(EMPTY_MOV);
  const [entradaForm, setEntradaForm] = useState(EMPTY_ENTRADA);
  const [facturaFile, setFacturaFile] = useState(null);

  const openMovModal = (itemId, tipo) => {
    setEntradaForm({ ...EMPTY_ENTRADA, itemId });
    setMovForm({ ...EMPTY_MOV, itemId });
    setFacturaFile(null);
    setMovModal({ itemId, tipo });
  };

  const handleFacturaPick = (e) => {
    const file = e.target.files[0] || null;
    if (file && file.size > MAX_FILE_SIZE) {
      toast.error('Archivo demasiado grande (máx 5 MB).');
      e.target.value = '';
      return;
    }
    setFacturaFile(file);
  };

  const handleSaveEntrada = async () => {
    const cantNum = parseDecimal(entradaForm.cantidad);
    if (!entradaForm.cantidad || isNaN(cantNum) || cantNum <= 0 || !isFinite(cantNum)) {
      toast.error('La cantidad debe ser un número positivo.'); return;
    }
    if (entradaForm.factura && entradaForm.factura.length > 100) { toast.error('Factura demasiado larga (máx 100).'); return; }
    if (entradaForm.oc && entradaForm.oc.length > 100) { toast.error('OC demasiado larga (máx 100).'); return; }
    const totalVal = entradaForm.total !== '' && entradaForm.total !== undefined ? parseDecimal(entradaForm.total) : null;
    if (totalVal !== null && (isNaN(totalVal) || totalVal < 0 || !isFinite(totalVal))) { toast.error('Total debe ser un número ≥ 0.'); return; }
    if (facturaFile && facturaFile.size > MAX_FILE_SIZE) { toast.error('Archivo demasiado grande (máx 5 MB).'); return; }
    setSaving(true);
    try {
      const payload = { ...entradaForm };
      if (facturaFile) {
        const { base64, mediaType } = await readFileAsBase64(facturaFile);
        payload.imageBase64 = base64;
        payload.mediaType   = mediaType;
      }
      const res = await apiFetch(`/api/bodegas/${bodegaId}/movimientos`, {
        method: 'POST', body: JSON.stringify(payload),
      });
      if (!res.ok) { const err = await res.json(); toast.error(err.message); return; }
      toast.success('Entrada registrada.');
      setMovModal(null);
      await afterMovChange();
    } catch {
      toast.error('Error de conexión.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMov = async () => {
    const cantNum = parseDecimal(movForm.cantidad);
    if (!movForm.cantidad || isNaN(cantNum) || cantNum <= 0 || !isFinite(cantNum)) {
      toast.error('La cantidad debe ser un número positivo.'); return;
    }
    if (movForm.nota && movForm.nota.length > 500) { toast.error('Nota demasiado larga (máx 500).'); return; }
    if (!movForm.activoId) { toast.error('El campo Activo es obligatorio.'); return; }
    if (!movForm.operarioId) { toast.error('El campo Operario es obligatorio.'); return; }
    // Resolver nombres para guardar junto con los IDs
    const loteSeleccionado     = lotes.find(l => l.id === movForm.loteId);
    const laborSeleccionada    = labores.find(l => l.id === movForm.laborId);
    const activoSeleccionado   = maquinaria.find(m => m.id === movForm.activoId);
    const operarioSeleccionado = usuarios.find(u => u.id === movForm.operarioId);
    const payload = {
      ...movForm,
      loteNombre:     loteSeleccionado?.nombreLote || '',
      laborNombre:    laborSeleccionada ? `${laborSeleccionada.codigo ? laborSeleccionada.codigo + ' - ' : ''}${laborSeleccionada.descripcion}` : '',
      activoNombre:   activoSeleccionado?.descripcion || '',
      operarioNombre: operarioSeleccionado?.nombre || '',
    };
    setSaving(true);
    try {
      const res = await apiFetch(`/api/bodegas/${bodegaId}/movimientos`, {
        method: 'POST', body: JSON.stringify(payload),
      });
      if (!res.ok) { const err = await res.json(); toast.error(err.message); return; }
      toast.success('Salida registrada.');
      setMovModal(null);
      await afterMovChange();
    } catch {
      toast.error('Error de conexión.');
    } finally {
      setSaving(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeItems = useMemo(() => items.filter(i => i.activo !== false), [items]);
  const lowStock    = useMemo(() => activeItems.filter(i => i.stockActual <= i.stockMinimo && i.stockMinimo > 0), [activeItems]);

  const empleados = useMemo(() => {
    const fichaIds = new Set(fichas.map(f => f.userId));
    return usuarios.filter(u => fichaIds.has(u.id)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [fichas, usuarios]);

  if (loading) return <div className="aur-page-loading">Cargando bodega...</div>;
  if (!bodega) return null;

  const itemForMov = movModal ? items.find(i => i.id === movModal.itemId) : null;

  // Validación inline de salida: cantidad no puede exceder el stock disponible.
  const salidaCant = parseDecimal(movForm.cantidad);
  const salidaExcede = movModal?.tipo === 'salida' && itemForMov
    && !isNaN(salidaCant) && salidaCant > (itemForMov.stockActual ?? 0);

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
          <button className="aur-btn-pill" onClick={() => setItemModal({ mode: 'create', data: { ...EMPTY_ITEM } })}>
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
          <EmptyState
            icon={FiBox}
            title={emptyStockTitle}
            action={
              <button className="aur-btn-pill" onClick={() => setItemModal({ mode: 'create', data: { ...EMPTY_ITEM } })}>
                <FiPlus size={14} /> Agregar producto
              </button>
            }
          />
        ) : (
          <div className="bg-table-wrap">
            <table className="bg-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Unidad</th>
                  <th className="text-right">Stock actual</th>
                  <th className="text-right">Stock mínimo</th>
                  <th>Moneda</th>
                  <th className="text-right">Total</th>
                  <th className="text-right" title="Costo promedio móvil = valor de inventario ÷ stock actual">
                    Costo prom. unit.
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {activeItems.map(item => {
                  const low = item.stockMinimo > 0 && item.stockActual <= item.stockMinimo;
                  const cost = avgUnitCost(item);
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
                      <td>{item.moneda || '—'}</td>
                      <td className="text-right">{item.total != null && item.total !== '' ? fmt(item.total) : '—'}</td>
                      <td className="text-right">{cost != null ? fmt(cost) : '—'}</td>
                      <td>
                        <div className="bg-row-actions">
                          <button className="bg-btn-mov entrada" onClick={() => openMovModal(item.id, 'entrada')} title="Registrar entrada">
                            <FiArrowDown size={14} /> Entrada
                          </button>
                          <button className="bg-btn-mov salida" onClick={() => openMovModal(item.id, 'salida')} title="Registrar salida">
                            <FiArrowUp size={14} /> Salida
                          </button>
                          <button className="ba-btn-icon" aria-label={`Editar ${item.nombre}`} onClick={() => setItemModal({ mode: 'edit', data: { ...item } })} title="Editar">
                            <FiEdit2 size={14} />
                          </button>
                          <button className="ba-btn-icon ba-btn-danger bg-btn-del" aria-label={`Eliminar ${item.nombre}`} onClick={() => setConfirmDel({ id: item.id, label: item.nombre })} title="Eliminar">
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
          <EmptyState
            icon={FiList}
            title="No hay movimientos registrados aún."
          />
        ) : (
          <MovimientosTable
            movs={movs}
            visibleCols={movVisibleCols}
            onToggleCol={toggleMovCol}
          />
        )
      )}

      {/* ── Modal Ítem ── */}
      {itemModal && (
        <AuroraModal
          size="wide"
          scrollable
          title={itemModal.mode === 'edit' ? 'Editar producto' : 'Agregar producto'}
          onClose={() => !saving && setItemModal(null)}
          footer={
            <>
              <button className="aur-btn-text" onClick={() => setItemModal(null)} disabled={saving}>Cancelar</button>
              <button className="aur-btn-pill" onClick={handleSaveItem} disabled={saving}>
                {saving ? 'Guardando…' : (itemModal.mode === 'edit' ? 'Guardar' : 'Agregar')}
              </button>
            </>
          }
        >
          <div className="aur-field">
            <label className="aur-field-label">Nombre</label>
            <input
              className="aur-input"
              value={itemModal.data.nombre}
              onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, nombre: e.target.value } }))}
              placeholder={itemNombrePlaceholder}
              maxLength={200}
              autoFocus
            />
          </div>
          <div className="bg-form-row">
            <div className="aur-field">
              <label className="aur-field-label">Unidad</label>
              <UnidadCombobox
                value={itemModal.data.unidad}
                onChange={v => setItemModal(m => ({ ...m, data: { ...m.data, unidad: v } }))}
              />
            </div>
            <div className="aur-field">
              <label className="aur-field-label">Stock actual</label>
              <input
                className="aur-input" type="number" min="0" inputMode="decimal"
                value={itemModal.data.stockActual}
                onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, stockActual: e.target.value } }))}
                placeholder="0"
              />
            </div>
            <div className="aur-field">
              <label className="aur-field-label">Stock mínimo</label>
              <input
                className="aur-input" type="number" min="0" inputMode="decimal"
                value={itemModal.data.stockMinimo}
                onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, stockMinimo: e.target.value } }))}
                placeholder="0"
              />
            </div>
          </div>
          <div className="aur-field">
            <label className="aur-field-label">Moneda</label>
            <select
              className="aur-select"
              value={itemModal.data.moneda || 'CRC'}
              onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, moneda: e.target.value } }))}
            >
              <option value="USD">USD</option>
              <option value="CRC">CRC</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div className="aur-field">
            <label className="aur-field-label">Total (valor inventario)</label>
            <input
              className="aur-input" type="number" min="0" step="0.01" inputMode="decimal"
              value={itemModal.data.total}
              onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, total: e.target.value } }))}
              placeholder="0.00"
            />
          </div>
          <div className="aur-field">
            <label className="aur-field-label">Descripción <span className="aur-field-hint">(opcional)</span></label>
            <input
              className="aur-input"
              value={itemModal.data.descripcion}
              onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, descripcion: e.target.value } }))}
              placeholder="Notas adicionales"
              maxLength={500}
            />
          </div>
        </AuroraModal>
      )}

      {/* ── Modal Entrada ── */}
      {movModal?.tipo === 'entrada' && (
        <AuroraModal
          icon={<FiArrowDown size={16} />}
          title={`Registrar Entrada${itemForMov ? ` — ${itemForMov.nombre}` : ''}`}
          scrollable
          onClose={() => !saving && setMovModal(null)}
          footer={
            <>
              <button className="aur-btn-text" onClick={() => setMovModal(null)} disabled={saving}>Cancelar</button>
              <button className="aur-btn-pill" onClick={handleSaveEntrada} disabled={saving}>
                {saving ? 'Guardando…' : 'Registrar entrada'}
              </button>
            </>
          }
        >
          <div className="bg-form-row">
            <div className="aur-field">
              <label className="aur-field-label">
                Cantidad{itemForMov?.unidad ? ` (${itemForMov.unidad})` : ''}
              </label>
              <input
                className="aur-input" type="number" min="0.01" step="0.01" inputMode="decimal"
                value={entradaForm.cantidad}
                onChange={e => setEntradaForm(f => ({ ...f, cantidad: e.target.value }))}
                placeholder="0"
                autoFocus
              />
            </div>
            <div className="aur-field">
              <label className="aur-field-label">Total</label>
              <input
                className="aur-input" type="number" min="0" step="0.01" inputMode="decimal"
                value={entradaForm.total}
                onChange={e => setEntradaForm(f => ({ ...f, total: e.target.value }))}
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="bg-form-row">
            <div className="aur-field">
              <label className="aur-field-label">Factura</label>
              <input
                className="aur-input"
                value={entradaForm.factura}
                onChange={e => setEntradaForm(f => ({ ...f, factura: e.target.value }))}
                placeholder="Nº de factura"
                maxLength={100}
              />
            </div>
            <div className="aur-field">
              <label className="aur-field-label">OC</label>
              <input
                className="aur-input"
                value={entradaForm.oc}
                onChange={e => setEntradaForm(f => ({ ...f, oc: e.target.value }))}
                placeholder="Orden de compra"
                maxLength={100}
              />
            </div>
          </div>
          {itemForMov && (
            <p className="bg-stock-hint">
              Stock actual: <strong>{fmt(itemForMov.stockActual)} {itemForMov.unidad}</strong>
            </p>
          )}
          <div className="aur-field">
            <label className="aur-field-label">Adjuntar factura <span className="aur-field-hint">(Imagen o PDF, máx 5 MB)</span></label>
            <label className="bg-file-label">
              <FiPaperclip size={15} />
              {facturaFile ? facturaFile.name : 'Seleccionar archivo…'}
              <input
                type="file"
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
                onChange={handleFacturaPick}
              />
            </label>
            {facturaFile && (
              <button className="bg-file-clear" type="button" onClick={() => setFacturaFile(null)}>
                <FiX size={13} /> Quitar archivo
              </button>
            )}
          </div>
        </AuroraModal>
      )}

      {/* ── Modal Salida ── */}
      {movModal?.tipo === 'salida' && (
        <AuroraModal
          icon={<FiArrowUp size={16} />}
          title={`Registrar Salida${itemForMov ? ` — ${itemForMov.nombre}` : ''}`}
          scrollable
          onClose={() => !saving && setMovModal(null)}
          footer={
            <>
              <button className="aur-btn-text" onClick={() => setMovModal(null)} disabled={saving}>Cancelar</button>
              <button className="aur-btn-pill" onClick={handleSaveMov} disabled={saving || salidaExcede}>
                {saving ? 'Guardando…' : 'Registrar salida'}
              </button>
            </>
          }
        >
          <div className="aur-field">
            <label className="aur-field-label">
              Cantidad{itemForMov?.unidad ? ` (${itemForMov.unidad})` : ''}
            </label>
            <input
              className={`aur-input${salidaExcede ? ' aur-input--error' : ''}`}
              type="number" min="0.01" step="0.01" inputMode="decimal"
              value={movForm.cantidad}
              onChange={e => setMovForm(f => ({ ...f, cantidad: e.target.value }))}
              placeholder="0"
              aria-invalid={salidaExcede || undefined}
              autoFocus
            />
            {salidaExcede && (
              <span className="bg-field-error">
                Excede el stock disponible de {fmt(itemForMov.stockActual)} {itemForMov.unidad}
              </span>
            )}
          </div>
          {itemForMov && !salidaExcede && (
            <p className="bg-stock-hint">
              Stock actual: <strong>{fmt(itemForMov.stockActual)} {itemForMov.unidad}</strong>
            </p>
          )}

          <div className="bg-form-row">
            <div className="aur-field">
              <label className="aur-field-label">Activo</label>
              <select className="aur-select" value={movForm.activoId}
                onChange={e => setMovForm(f => ({ ...f, activoId: e.target.value }))}>
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
            <div className="aur-field">
              <label className="aur-field-label">Operario</label>
              <select className="aur-select" value={movForm.operarioId}
                onChange={e => setMovForm(f => ({ ...f, operarioId: e.target.value }))}>
                <option value="">— Seleccionar —</option>
                {empleados.map(u => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-form-row">
            <div className="aur-field">
              <label className="aur-field-label">Lote</label>
              <select className="aur-select" value={movForm.loteId}
                onChange={e => setMovForm(f => ({ ...f, loteId: e.target.value }))}>
                <option value="">— Ninguno —</option>
                {lotes.map(l => (
                  <option key={l.id} value={l.id}>{l.nombreLote}</option>
                ))}
              </select>
            </div>
            <div className="aur-field">
              <label className="aur-field-label">Labor</label>
              <select className="aur-select" value={movForm.laborId}
                onChange={e => setMovForm(f => ({ ...f, laborId: e.target.value }))}>
                <option value="">— Ninguna —</option>
                {labores.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.codigo ? `${l.codigo} - ` : ''}{l.descripcion}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="aur-field">
            <label className="aur-field-label">Nota <span className="aur-field-hint">(opcional)</span></label>
            <input
              className="aur-input"
              value={movForm.nota}
              onChange={e => setMovForm(f => ({ ...f, nota: e.target.value }))}
              placeholder="Motivo, proveedor, etc."
              maxLength={500}
            />
          </div>
        </AuroraModal>
      )}

      {confirmDel && (
        <AuroraConfirmModal
          danger
          title="Eliminar producto"
          body={`¿Eliminar "${confirmDel.label}"? Esta acción es permanente y solo funciona si el producto no tiene movimientos registrados.`}
          confirmLabel="Eliminar"
          onConfirm={() => { handleDeleteItem(confirmDel.id); setConfirmDel(null); }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
