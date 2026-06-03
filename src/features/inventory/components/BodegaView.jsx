import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiBox, FiPlus, FiEdit2, FiTrash2, FiArrowUp, FiArrowDown,
  FiAlertTriangle, FiList, FiArchive, FiPaperclip, FiX, FiSearch,
} from 'react-icons/fi';
import AuroraModal from '../../../components/AuroraModal';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import UnidadCombobox from './UnidadCombobox';
import MovimientosTable from './MovimientosTable';
import {
  ICON_MAP, fmt, fmtMoney, avgUnitCost, parseDecimal, readFileAsBase64,
  EMPTY_ITEM, EMPTY_MOV, EMPTY_ENTRADA, MAX_FILE_SIZE, MONEDAS,
  loadVisibleCols, saveVisibleCols,
  validateItem, validateEntrada, validateSalida,
  itemFormDirty, entradaFormDirty, movFormDirty,
} from '../lib/bodega';
import '../styles/bodega-generica.css';

const BodegaIcon = ({ iconKey, size = 20 }) => {
  const Icon = ICON_MAP[iconKey] || FiBox;
  return <Icon size={size} />;
};

// Catálogos finca-globales (lotes, usuarios, fichas, maquinaria, labores) no
// dependen de la bodega: se cachean a nivel de módulo para no re-pedirlos al
// navegar entre bodegas. Viven la sesión; se repueblan al recargar la página.
let catalogCache = null;

/**
 * Vista compartida de bodega (combustibles + genérica). Las páginas wrapper
 * solo difieren en cómo resuelven la bodega y en el copy, así que se inyecta:
 *   - resolveBodega(bodegas, navigate) → bodega | null   (puede redirigir)
 *   - emptyStockTitle  string · copy del empty-state de existencias vacías
 *   - itemNombrePlaceholder string · placeholder del nombre en el form
 *   - requireActivo bool · si la salida exige asociar un activo/maquinaria
 *       (combustibles: sí; genérica: no — tornillos/EPP no van contra máquina)
 */
export default function BodegaView({
  resolveBodega,
  emptyStockTitle,
  itemNombrePlaceholder,
  requireActivo = false,
}) {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const navigate = useNavigate();

  const [bodega,   setBodega]   = useState(null);
  const [items,    setItems]    = useState([]);
  const [movs,     setMovs]     = useState([]);
  const [loading,  setLoading]  = useState(true); // solo el primer mount
  const [loadError, setLoadError] = useState(false);
  const [tab,      setTab]      = useState('existencias');
  const [query,    setQuery]    = useState('');

  const bodegaId = bodega?.id;
  const movsLoaded = useRef(false);
  const flashTimer = useRef(null);

  // Catálogos para los selects del form de movimientos.
  const [lotes,      setLotes]      = useState([]);
  const [usuarios,   setUsuarios]   = useState([]);
  const [fichas,     setFichas]     = useState([]);
  const [maquinaria, setMaquinaria] = useState([]);
  const [labores,    setLabores]    = useState([]);

  // Modals
  const [itemModal,  setItemModal]  = useState(null);  // null | {mode, data}
  const [movModal,   setMovModal]   = useState(null);  // null | {itemId, tipo}
  const [confirmDel, setConfirmDel] = useState(null);  // null | {id, label, stock, unidad}
  const [discardAsk, setDiscardAsk] = useState(false); // confirmar descarte de form

  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formErr,  setFormErr]  = useState(null);      // null | {field, message}
  const [flashItemId, setFlashItemId] = useState(null);

  // Forms de movimiento (declarados acá arriba: varios efectos dependen de ellos).
  const [movForm,     setMovForm]     = useState(EMPTY_MOV);
  const [entradaForm, setEntradaForm] = useState(EMPTY_ENTRADA);
  const [facturaFile, setFacturaFile] = useState(null);
  const facturaInputRef = useRef(null);

  // Visibilidad de columnas de movimientos (persistida por bodega).
  const [movVisibleCols, setMovVisibleCols] = useState(loadVisibleCols);
  const toggleMovCol = useCallback((key) => {
    setMovVisibleCols(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveVisibleCols(next, bodegaId);
      return next;
    });
  }, [bodegaId]);

  // ── Fetch ───────────────────────────────────────────────────────────────
  const fetchAll = useCallback((initial = false) => {
    if (initial) setLoading(true);
    setLoadError(false);
    const catalogsP = catalogCache
      ? Promise.resolve(catalogCache)
      : Promise.all([
          apiFetch('/api/lotes').then(r => r.json()),
          apiFetch('/api/users/lite').then(r => r.json()),
          apiFetch('/api/hr/fichas').then(r => r.json()),
          apiFetch('/api/maquinaria').then(r => r.json()),
          apiFetch('/api/labores').then(r => r.json()),
        ]).then(([lotesData, usuariosData, fichasData, maquinariaData, laboresData]) => {
          catalogCache = {
            lotes:      Array.isArray(lotesData) ? lotesData : [],
            usuarios:   Array.isArray(usuariosData) ? usuariosData : [],
            fichas:     Array.isArray(fichasData) ? fichasData : [],
            maquinaria: Array.isArray(maquinariaData) ? maquinariaData : [],
            labores:    Array.isArray(laboresData) ? laboresData : [],
          };
          return catalogCache;
        });

    return Promise.all([apiFetch('/api/bodegas').then(r => r.json()), catalogsP])
      .then(async ([bodegas, cat]) => {
        const b = resolveBodega(Array.isArray(bodegas) ? bodegas : [], navigate);
        if (!b) return; // resolveBodega ya redirigió
        setBodega(b);
        setLotes(cat.lotes);
        setUsuarios(cat.usuarios);
        setFichas(cat.fichas);
        setMaquinaria(cat.maquinaria);
        setLabores(cat.labores);
        const itemsData = await apiFetch(`/api/bodegas/${b.id}/items`).then(r => r.json());
        setItems(Array.isArray(itemsData) ? itemsData : []);
      })
      .catch(() => { setLoadError(true); toast.error('Error al cargar datos.'); })
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

  // Al cambiar de bodega (React Router reusa la instancia), invalidar la pestaña
  // de movimientos y recargar la preferencia de columnas de ESA bodega. Sin esto
  // se mostraban los movimientos de la bodega anterior.
  useEffect(() => {
    movsLoaded.current = false;
    setMovs([]);
    setQuery('');
    if (bodegaId) setMovVisibleCols(loadVisibleCols(bodegaId));
  }, [bodegaId]);

  // La pestaña de movimientos se pide una vez; se invalida tras registrar uno.
  useEffect(() => {
    if (tab === 'movimientos' && bodegaId && !movsLoaded.current) fetchMovs();
  }, [tab, bodegaId, fetchMovs]);

  // El error de submit se limpia solo en cuanto el usuario toca cualquier form.
  useEffect(() => { setFormErr(null); }, [itemModal?.data, entradaForm, movForm]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const flashRow = useCallback((itemId) => {
    if (!itemId) return;
    setFlashItemId(itemId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashItemId(null), 1700);
  }, []);

  const afterMovChange = useCallback(async (itemId) => {
    await refreshItems();
    movsLoaded.current = false;
    if (tab === 'movimientos') await fetchMovs();
    flashRow(itemId);
  }, [refreshItems, fetchMovs, tab, flashRow]);

  // ── Cierre de modales con guardia de descarte ──────────────────────────────
  const doClose = useCallback(() => {
    setItemModal(null);
    setMovModal(null);
    setFacturaFile(null);
    if (facturaInputRef.current) facturaInputRef.current.value = '';
    setFormErr(null);
  }, []);

  const requestClose = useCallback(() => {
    if (saving) return;
    const dirty = itemModal
      ? itemFormDirty(itemModal.data)
      : movModal?.tipo === 'entrada'
        ? entradaFormDirty(entradaForm, facturaFile)
        : movModal?.tipo === 'salida'
          ? movFormDirty(movForm)
          : false;
    if (dirty) { setDiscardAsk(true); return; }
    doClose();
  }, [saving, itemModal, movModal, entradaForm, facturaFile, movForm, doClose]);

  // ── Item CRUD ─────────────────────────────────────────────────────────────
  const handleSaveItem = async () => {
    const { mode, data } = itemModal;
    const err = validateItem(data);
    if (err) { setFormErr(err); toast.error(err.message); return; }
    setSaving(true);
    try {
      const method = mode === 'edit' ? 'PUT' : 'POST';
      const url = mode === 'edit'
        ? `/api/bodegas/${bodegaId}/items/${data.id}`
        : `/api/bodegas/${bodegaId}/items`;
      const res = await apiFetch(url, { method, body: JSON.stringify(data) });
      if (!res.ok) { const e = await res.json(); toast.error(e.message); return; }
      toast.success(mode === 'edit' ? 'Producto actualizado.' : 'Producto agregado.');
      doClose();
      await refreshItems();
    } catch {
      toast.error('Error de conexión.');
    } finally {
      setSaving(false);
    }
  };

  // Devuelve true si el borrado fue exitoso (para que el confirm sepa si cerrar).
  const handleDeleteItem = async (id) => {
    try {
      const res = await apiFetch(`/api/bodegas/${bodegaId}/items/${id}`, { method: 'DELETE' });
      if (!res.ok) { const e = await res.json(); toast.error(e.message); return false; }
      toast.success('Producto eliminado.');
      await refreshItems();
      return true;
    } catch {
      toast.error('Error de conexión.');
      return false;
    }
  };

  // ── Movimientos ───────────────────────────────────────────────────────────
  const openMovModal = (itemId, tipo) => {
    setEntradaForm({ ...EMPTY_ENTRADA, itemId });
    setMovForm({ ...EMPTY_MOV, itemId });
    setFacturaFile(null);
    if (facturaInputRef.current) facturaInputRef.current.value = '';
    setFormErr(null);
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

  const clearFactura = () => {
    setFacturaFile(null);
    if (facturaInputRef.current) facturaInputRef.current.value = '';
  };

  const handleSaveEntrada = async () => {
    const err = validateEntrada(entradaForm);
    if (err) { setFormErr(err); toast.error(err.message); return; }
    if (facturaFile && facturaFile.size > MAX_FILE_SIZE) { toast.error('Archivo demasiado grande (máx 5 MB).'); return; }
    const itemId = movModal.itemId;
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
      if (!res.ok) { const e = await res.json(); toast.error(e.message); return; }
      toast.success('Entrada registrada.');
      doClose();
      await afterMovChange(itemId);
    } catch {
      toast.error('Error de conexión.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMov = async () => {
    const stockActual = itemForMov?.stockActual ?? 0;
    const err = validateSalida(movForm, { stockActual, requireActivo });
    if (err) { setFormErr(err); toast.error(err.message); return; }
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
    const itemId = movModal.itemId;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/bodegas/${bodegaId}/movimientos`, {
        method: 'POST', body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json(); toast.error(e.message); return; }
      toast.success('Salida registrada.');
      doClose();
      await afterMovChange(itemId);
    } catch {
      toast.error('Error de conexión.');
    } finally {
      setSaving(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeItems = useMemo(() => items.filter(i => i.activo !== false), [items]);
  const inactiveCount = items.length - activeItems.length;
  const lowStock    = useMemo(() => activeItems.filter(i => i.stockActual <= i.stockMinimo && i.stockMinimo > 0), [activeItems]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeItems;
    return activeItems.filter(i =>
      (i.nombre || '').toLowerCase().includes(q) ||
      (i.descripcion || '').toLowerCase().includes(q) ||
      (i.unidad || '').toLowerCase().includes(q));
  }, [activeItems, query]);

  const empleados = useMemo(() => {
    const fichaIds = new Set(fichas.map(f => f.userId));
    return usuarios.filter(u => fichaIds.has(u.id)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [fichas, usuarios]);

  if (loading) return <div className="aur-page-loading">Cargando bodega...</div>;
  if (loadError && !bodega) {
    return (
      <div className="lm-container bg-page">
        <EmptyState
          icon={FiAlertTriangle}
          title="No se pudieron cargar los datos de la bodega."
          subtitle="Revisá tu conexión e intentá de nuevo."
          action={<button className="aur-btn-pill" onClick={() => fetchAll(true)}>Reintentar</button>}
        />
      </div>
    );
  }
  if (!bodega) return null;

  const itemForMov = movModal ? items.find(i => i.id === movModal.itemId) : null;
  const isEdit = itemModal?.mode === 'edit';

  // Validación inline de salida (live): cantidad inválida o que excede el stock
  // deshabilita el submit y muestra el motivo bajo el campo.
  const salidaCant = parseDecimal(movForm.cantidad);
  const salidaExcede = movModal?.tipo === 'salida' && itemForMov
    && !isNaN(salidaCant) && salidaCant > (itemForMov.stockActual ?? 0);
  const salidaCantInvalid = movModal?.tipo === 'salida' && movForm.cantidad !== ''
    && (isNaN(salidaCant) || salidaCant <= 0);
  const salidaBlock = salidaExcede || salidaCantInvalid;

  const fieldErr = (name) => (formErr?.field === name ? formErr.message : null);
  const renderFieldErr = (name) => {
    const msg = fieldErr(name);
    return msg ? <span className="bg-field-error">{msg}</span> : null;
  };

  return (
    <div className="lm-container bg-page">
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
      <div className="bg-tabs" role="tablist" aria-label="Vistas de bodega">
        <button
          role="tab" id="bg-tab-existencias" aria-selected={tab === 'existencias'} aria-controls="bg-panel-existencias"
          className={`bg-tab${tab === 'existencias' ? ' active' : ''}`} onClick={() => setTab('existencias')}
        >
          <FiArchive size={15} /> Existencias
        </button>
        <button
          role="tab" id="bg-tab-movimientos" aria-selected={tab === 'movimientos'} aria-controls="bg-panel-movimientos"
          className={`bg-tab${tab === 'movimientos' ? ' active' : ''}`} onClick={() => setTab('movimientos')}
        >
          <FiList size={15} /> Movimientos
        </button>
      </div>

      {/* ── Existencias ── */}
      {tab === 'existencias' && (
        <div role="tabpanel" id="bg-panel-existencias" aria-labelledby="bg-tab-existencias">
          {items.length === 0 ? (
            <EmptyState
              icon={FiBox}
              title={emptyStockTitle}
              action={
                <button className="aur-btn-pill" onClick={() => setItemModal({ mode: 'create', data: { ...EMPTY_ITEM } })}>
                  <FiPlus size={14} /> Agregar producto
                </button>
              }
            />
          ) : activeItems.length === 0 ? (
            <EmptyState
              icon={FiArchive}
              title="Todos los productos están inactivos."
              subtitle={`Hay ${inactiveCount} producto${inactiveCount === 1 ? '' : 's'} inactivo${inactiveCount === 1 ? '' : 's'}. Agregá uno nuevo para empezar.`}
              action={
                <button className="aur-btn-pill" onClick={() => setItemModal({ mode: 'create', data: { ...EMPTY_ITEM } })}>
                  <FiPlus size={14} /> Agregar producto
                </button>
              }
            />
          ) : (
            <>
              <div className="bg-toolbar">
                <input
                  className="aur-input bg-search"
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar por nombre, descripción o unidad…"
                  aria-label="Buscar producto"
                />
                <span className="bg-toolbar-count">
                  {filteredItems.length} de {activeItems.length}
                </span>
              </div>

              {filteredItems.length === 0 ? (
                <EmptyState
                  icon={FiSearch}
                  title={`Sin resultados para "${query.trim()}".`}
                  action={<button className="aur-btn-text" onClick={() => setQuery('')}>Limpiar búsqueda</button>}
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
                        <th className="text-right">Total</th>
                        <th className="text-right" title="Costo promedio móvil = valor de inventario ÷ stock actual">
                          Costo prom. unit.
                        </th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map(item => {
                        const low = item.stockMinimo > 0 && item.stockActual <= item.stockMinimo;
                        const cost = avgUnitCost(item);
                        const hasStock = (item.stockActual ?? 0) > 0;
                        return (
                          <tr key={item.id} className={[low ? 'bg-row-low' : '', flashItemId === item.id ? 'bg-row-flash' : ''].filter(Boolean).join(' ')}>
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
                            <td className="text-right">{fmtMoney(item.total, item.moneda)}</td>
                            <td className="text-right">{cost != null ? fmtMoney(cost, item.moneda) : '—'}</td>
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
                                <button
                                  className="ba-btn-icon ba-btn-danger bg-btn-del"
                                  aria-label={`Eliminar ${item.nombre}`}
                                  disabled={hasStock}
                                  onClick={() => setConfirmDel({ id: item.id, label: item.nombre, stock: item.stockActual, unidad: item.unidad })}
                                  title={hasStock ? 'No se puede eliminar: tiene stock. Registrá una salida primero.' : 'Eliminar'}
                                >
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
              )}
            </>
          )}
        </div>
      )}

      {/* ── Movimientos ── */}
      {tab === 'movimientos' && (
        <div role="tabpanel" id="bg-panel-movimientos" aria-labelledby="bg-tab-movimientos">
          {movs.length === 0 ? (
            <EmptyState icon={FiList} title="No hay movimientos registrados aún." />
          ) : (
            <MovimientosTable
              movs={movs}
              visibleCols={movVisibleCols}
              onToggleCol={toggleMovCol}
            />
          )}
        </div>
      )}

      {/* ── Modal Ítem ── */}
      {itemModal && (
        <AuroraModal
          size="wide"
          scrollable
          title={isEdit ? 'Editar producto' : 'Agregar producto'}
          onClose={requestClose}
          footer={
            <>
              <button className="aur-btn-text" onClick={requestClose} disabled={saving}>Cancelar</button>
              <button className="aur-btn-pill" onClick={handleSaveItem} disabled={saving}>
                {saving ? 'Guardando…' : (isEdit ? 'Guardar' : 'Agregar')}
              </button>
            </>
          }
        >
          <div className="aur-field">
            <label className="aur-field-label">Nombre</label>
            <input
              className={`aur-input${fieldErr('nombre') ? ' aur-input--error' : ''}`}
              value={itemModal.data.nombre}
              onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, nombre: e.target.value } }))}
              placeholder={itemNombrePlaceholder}
              maxLength={200}
              aria-invalid={fieldErr('nombre') ? true : undefined}
              autoFocus
            />
            {renderFieldErr('nombre')}
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
              <label className="aur-field-label">
                Stock actual{isEdit && <span className="aur-field-hint"> (se ajusta con movimientos)</span>}
              </label>
              <input
                className={`aur-input${fieldErr('stockActual') ? ' aur-input--error' : ''}`}
                type="number" min="0" inputMode="decimal"
                value={itemModal.data.stockActual}
                onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, stockActual: e.target.value } }))}
                placeholder="0"
                disabled={isEdit}
                title={isEdit ? 'Usá Entrada/Salida para mover el stock' : undefined}
              />
              {renderFieldErr('stockActual')}
            </div>
            <div className="aur-field">
              <label className="aur-field-label">Stock mínimo</label>
              <input
                className={`aur-input${fieldErr('stockMinimo') ? ' aur-input--error' : ''}`}
                type="number" min="0" inputMode="decimal"
                value={itemModal.data.stockMinimo}
                onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, stockMinimo: e.target.value } }))}
                placeholder="0"
              />
              {renderFieldErr('stockMinimo')}
            </div>
          </div>
          <div className="aur-field">
            <label className="aur-field-label">Moneda</label>
            <select
              className="aur-select"
              value={itemModal.data.moneda || 'CRC'}
              onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, moneda: e.target.value } }))}
            >
              {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="aur-field">
            <label className="aur-field-label">
              Total (valor inventario)
              {isEdit && <span className="aur-field-hint"> (se acumula con cada entrada)</span>}
            </label>
            <input
              className={`aur-input${fieldErr('total') ? ' aur-input--error' : ''}`}
              type="number" min="0" step="0.01" inputMode="decimal"
              value={itemModal.data.total}
              onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, total: e.target.value } }))}
              placeholder="0.00"
              disabled={isEdit}
              title={isEdit ? 'El total se actualiza con las entradas; el costo unitario se deriva de este valor' : undefined}
            />
            {!isEdit && <span className="aur-field-hint">Valor inicial del inventario. Las entradas lo incrementan y el costo unitario se deriva de él.</span>}
            {renderFieldErr('total')}
          </div>
          <div className="aur-field">
            <label className="aur-field-label">Descripción <span className="aur-field-hint">(opcional)</span></label>
            <input
              className={`aur-input${fieldErr('descripcion') ? ' aur-input--error' : ''}`}
              value={itemModal.data.descripcion}
              onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, descripcion: e.target.value } }))}
              placeholder="Notas adicionales"
              maxLength={500}
            />
            {renderFieldErr('descripcion')}
          </div>
        </AuroraModal>
      )}

      {/* ── Modal Entrada ── */}
      {movModal?.tipo === 'entrada' && (
        <AuroraModal
          icon={<FiArrowDown size={16} />}
          title={`Registrar Entrada${itemForMov ? ` — ${itemForMov.nombre}` : ''}`}
          scrollable
          onClose={requestClose}
          footer={
            <>
              <button className="aur-btn-text" onClick={requestClose} disabled={saving}>Cancelar</button>
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
                className={`aur-input${fieldErr('cantidad') ? ' aur-input--error' : ''}`}
                type="number" min="0.01" step="0.01" inputMode="decimal"
                value={entradaForm.cantidad}
                onChange={e => setEntradaForm(f => ({ ...f, cantidad: e.target.value }))}
                placeholder="0"
                aria-invalid={fieldErr('cantidad') ? true : undefined}
                autoFocus
              />
              {renderFieldErr('cantidad')}
            </div>
            <div className="aur-field">
              <label className="aur-field-label">Total</label>
              <input
                className={`aur-input${fieldErr('total') ? ' aur-input--error' : ''}`}
                type="number" min="0" step="0.01" inputMode="decimal"
                value={entradaForm.total}
                onChange={e => setEntradaForm(f => ({ ...f, total: e.target.value }))}
                placeholder="0.00"
              />
              {renderFieldErr('total')}
            </div>
          </div>
          <div className="bg-form-row">
            <div className="aur-field">
              <label className="aur-field-label">Factura</label>
              <input
                className={`aur-input${fieldErr('factura') ? ' aur-input--error' : ''}`}
                value={entradaForm.factura}
                onChange={e => setEntradaForm(f => ({ ...f, factura: e.target.value }))}
                placeholder="Nº de factura"
                maxLength={100}
              />
              {renderFieldErr('factura')}
            </div>
            <div className="aur-field">
              <label className="aur-field-label">OC</label>
              <input
                className={`aur-input${fieldErr('oc') ? ' aur-input--error' : ''}`}
                value={entradaForm.oc}
                onChange={e => setEntradaForm(f => ({ ...f, oc: e.target.value }))}
                placeholder="Orden de compra"
                maxLength={100}
              />
              {renderFieldErr('oc')}
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
                ref={facturaInputRef}
                type="file"
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
                onChange={handleFacturaPick}
              />
            </label>
            {facturaFile && (
              <button className="bg-file-clear" type="button" onClick={clearFactura}>
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
          onClose={requestClose}
          footer={
            <>
              <button className="aur-btn-text" onClick={requestClose} disabled={saving}>Cancelar</button>
              <button className="aur-btn-pill" onClick={handleSaveMov} disabled={saving || salidaBlock}>
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
              className={`aur-input${(salidaBlock || fieldErr('cantidad')) ? ' aur-input--error' : ''}`}
              type="number" min="0.01" step="0.01" inputMode="decimal"
              value={movForm.cantidad}
              onChange={e => setMovForm(f => ({ ...f, cantidad: e.target.value }))}
              placeholder="0"
              aria-invalid={(salidaBlock || fieldErr('cantidad')) ? true : undefined}
              autoFocus
            />
            {salidaExcede ? (
              <span className="bg-field-error">
                Excede el stock disponible de {fmt(itemForMov.stockActual)} {itemForMov.unidad}
              </span>
            ) : salidaCantInvalid ? (
              <span className="bg-field-error">La cantidad debe ser un número positivo.</span>
            ) : renderFieldErr('cantidad')}
          </div>
          {itemForMov && !salidaBlock && (
            <p className="bg-stock-hint">
              Stock actual: <strong>{fmt(itemForMov.stockActual)} {itemForMov.unidad}</strong>
            </p>
          )}

          <div className="bg-form-row">
            <div className="aur-field">
              <label className="aur-field-label">Activo {!requireActivo && <span className="aur-field-hint">(opcional)</span>}</label>
              <select
                className={`aur-select${fieldErr('activoId') ? ' aur-input--error' : ''}`}
                value={movForm.activoId}
                aria-invalid={fieldErr('activoId') ? true : undefined}
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
              {renderFieldErr('activoId')}
            </div>
            <div className="aur-field">
              <label className="aur-field-label">Operario</label>
              <select
                className={`aur-select${fieldErr('operarioId') ? ' aur-input--error' : ''}`}
                value={movForm.operarioId}
                aria-invalid={fieldErr('operarioId') ? true : undefined}
                onChange={e => setMovForm(f => ({ ...f, operarioId: e.target.value }))}
                disabled={empleados.length === 0}
              >
                <option value="">— Seleccionar —</option>
                {empleados.map(u => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
              {empleados.length === 0
                ? <span className="aur-field-hint">No hay empleados con ficha. Creá uno en Ficha del Trabajador.</span>
                : renderFieldErr('operarioId')}
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
              className={`aur-input${fieldErr('nota') ? ' aur-input--error' : ''}`}
              value={movForm.nota}
              onChange={e => setMovForm(f => ({ ...f, nota: e.target.value }))}
              placeholder="Motivo, proveedor, etc."
              maxLength={500}
            />
            {renderFieldErr('nota')}
          </div>
        </AuroraModal>
      )}

      {/* ── Confirmar descarte de form con cambios ── */}
      {discardAsk && (
        <AuroraConfirmModal
          title="¿Descartar cambios?"
          body="Hay datos sin guardar en el formulario. Si cerrás, se perderán."
          confirmLabel="Descartar"
          cancelLabel="Seguir editando"
          danger
          onConfirm={() => { setDiscardAsk(false); doClose(); }}
          onCancel={() => setDiscardAsk(false)}
        />
      )}

      {confirmDel && (
        <AuroraConfirmModal
          danger
          title="Eliminar producto"
          body={
            `¿Eliminar "${confirmDel.label}"? Stock actual: ${fmt(confirmDel.stock)} ${confirmDel.unidad || ''}. `
            + 'Esta acción es permanente y solo es posible si el producto no tiene movimientos registrados.'
          }
          confirmLabel="Eliminar"
          loading={deleting}
          loadingLabel="Eliminando…"
          onConfirm={async () => {
            setDeleting(true);
            const ok = await handleDeleteItem(confirmDel.id);
            setDeleting(false);
            if (ok) setConfirmDel(null);
          }}
          onCancel={() => { if (!deleting) setConfirmDel(null); }}
        />
      )}
    </div>
  );
}
